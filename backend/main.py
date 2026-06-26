"""FastAPI backend — OAuth login + chat API that calls Glean MCP."""

from __future__ import annotations

import json
import logging
import secrets
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse
from pydantic import BaseModel
from sse_starlette.sse import EventSourceResponse
from starlette.middleware.sessions import SessionMiddleware

from chat_handler import handle_chat
from config import settings
from oauth_service import OAuthTokens, PendingAuth, ensure_valid_token, finish_login, start_login
from session_mcp import session_mcp

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

OAUTH_SESSION_KEY = "oauth"
PENDING_SESSION_KEY = "oauth_pending"
MCP_URL_SESSION_KEY = "glean_mcp_url"


def _session_id(request: Request) -> str:
    session = request.session
    if "sid" not in session:
        session["sid"] = secrets.token_urlsafe(16)
    return session["sid"]


def _get_mcp_url(request: Request) -> str:
    return (request.session.get(MCP_URL_SESSION_KEY) or settings.glean_mcp_url or "").rstrip("/")


def _get_tokens(request: Request) -> OAuthTokens | None:
    raw = request.session.get(OAUTH_SESSION_KEY)
    if not raw:
        return None
    return OAuthTokens.from_dict(raw)


def _set_tokens(request: Request, tokens: OAuthTokens) -> None:
    request.session[OAUTH_SESSION_KEY] = tokens.to_dict()


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield
    await session_mcp.disconnect_all()


app = FastAPI(title="MCP Chatbot", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        settings.frontend_url,
        "http://localhost:5174",
        "http://localhost:3000",
        "http://127.0.0.1:5174",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(SessionMiddleware, secret_key=settings.session_secret, https_only=False)


class ChatMessage(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    messages: list[ChatMessage]


class ConfigRequest(BaseModel):
    glean_mcp_url: str


@app.get("/api/config")
async def get_config(request: Request) -> dict[str, str | None]:
    url = _get_mcp_url(request)
    return {"glean_mcp_url": url or None}


@app.post("/api/config")
async def set_config(req: ConfigRequest, request: Request) -> dict[str, str]:
    url = req.glean_mcp_url.strip().rstrip("/")
    if not url:
        raise HTTPException(status_code=400, detail="Glean MCP URL is required")
    if not url.startswith("http://") and not url.startswith("https://"):
        raise HTTPException(status_code=400, detail="URL must start with http:// or https://")

    previous = request.session.get(MCP_URL_SESSION_KEY)
    if previous != url:
        await session_mcp.remove(_session_id(request))
        request.session.pop(OAUTH_SESSION_KEY, None)

    request.session[MCP_URL_SESSION_KEY] = url
    return {"glean_mcp_url": url}


@app.get("/api/health")
async def health(request: Request) -> dict[str, Any]:
    mcp_url = _get_mcp_url(request)
    tokens = _get_tokens(request)
    authenticated = bool(tokens and tokens.is_valid()) or bool(settings.glean_mcp_token)
    mcp_status: dict[str, Any] = {"connected": False, "tool_count": 0, "primary_tool": None}

    if mcp_url and authenticated:
        try:
            access = settings.glean_mcp_token or (tokens.access_token if tokens else "")
            client = await session_mcp.get(_session_id(request), access, mcp_url)
            mcp_status = client.status()
        except Exception:
            logger.exception("MCP health check failed")

    return {
        "status": "ok",
        "mcp_configured": bool(mcp_url),
        "glean_mcp_url": mcp_url or None,
        "authenticated": authenticated,
        "auth_mode": "token" if settings.glean_mcp_token else "oauth",
        "mcp": mcp_status,
    }


@app.get("/api/auth/login")
async def auth_login(request: Request):
    if settings.glean_mcp_token:
        return RedirectResponse(url=settings.frontend_url)

    mcp_url = _get_mcp_url(request)
    if not mcp_url:
        raise HTTPException(status_code=400, detail="Set Glean MCP URL first")

    try:
        authorize_url, pending = await start_login(mcp_url)
    except Exception as exc:
        logger.exception("OAuth login start failed")
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    request.session[PENDING_SESSION_KEY] = {
        "state": pending.state,
        "code_verifier": pending.code_verifier,
        "client_id": pending.client_id,
        "redirect_uri": pending.redirect_uri,
    }
    return RedirectResponse(url=authorize_url)


@app.get("/api/auth/callback")
async def auth_callback(request: Request, code: str | None = None, state: str | None = None, error: str | None = None):
    if error:
        return RedirectResponse(url=f"{settings.frontend_url}?auth_error={error}")

    if not code or not state:
        raise HTTPException(status_code=400, detail="Missing code or state")

    mcp_url = _get_mcp_url(request)
    if not mcp_url:
        return RedirectResponse(url=f"{settings.frontend_url}?auth_error=mcp_url_missing")

    pending_raw = request.session.pop(PENDING_SESSION_KEY, None)
    if not pending_raw or pending_raw.get("state") != state:
        raise HTTPException(status_code=400, detail="Invalid OAuth state")

    pending = PendingAuth(
        state=pending_raw["state"],
        code_verifier=pending_raw["code_verifier"],
        client_id=pending_raw["client_id"],
        redirect_uri=pending_raw["redirect_uri"],
    )

    try:
        tokens = await finish_login(code, pending, mcp_url)
    except Exception:
        logger.exception("OAuth token exchange failed")
        return RedirectResponse(url=f"{settings.frontend_url}?auth_error=token_exchange_failed")

    _set_tokens(request, tokens)
    return RedirectResponse(url=settings.frontend_url)


@app.post("/api/auth/logout")
async def auth_logout(request: Request) -> dict[str, str]:
    sid = _session_id(request)
    await session_mcp.remove(sid)
    request.session.pop(OAUTH_SESSION_KEY, None)
    return {"status": "ok"}


async def _resolve_mcp_client(request: Request):
    mcp_url = _get_mcp_url(request)
    if not mcp_url:
        raise HTTPException(status_code=400, detail="Set Glean MCP URL first")

    if settings.glean_mcp_token:
        return await session_mcp.get(_session_id(request), settings.glean_mcp_token, mcp_url)

    tokens = _get_tokens(request)
    tokens = await ensure_valid_token(tokens, mcp_url)
    if not tokens:
        raise HTTPException(status_code=401, detail="Not signed in. Visit /api/auth/login.")

    _set_tokens(request, tokens)
    return await session_mcp.get(_session_id(request), tokens.access_token, mcp_url)


@app.post("/api/chat")
async def chat(req: ChatRequest, request: Request) -> EventSourceResponse:
    if not _get_mcp_url(request):
        raise HTTPException(status_code=400, detail="Set Glean MCP URL first")

    try:
        mcp_client = await _resolve_mcp_client(request)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    user_messages = [{"role": m.role, "content": m.content} for m in req.messages]

    async def event_generator():
        try:
            async for event in handle_chat(mcp_client, user_messages):
                yield {"event": event["type"], "data": json.dumps(event)}
            yield {"event": "done", "data": "{}"}
        except Exception as exc:
            logger.exception("Chat error")
            yield {
                "event": "error",
                "data": json.dumps({"type": "error", "content": str(exc)}),
            }

    return EventSourceResponse(event_generator())


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host=settings.host, port=settings.port, reload=True)
