"""OAuth 2.0 + PKCE + Dynamic Client Registration for Glean MCP."""

from __future__ import annotations

import base64
import hashlib
import json
import logging
import re
import secrets
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import urlencode, urlsplit, urlunsplit

import httpx

from config import settings

logger = logging.getLogger(__name__)

TOKEN_EXPIRY_BUFFER_SEC = 300


@dataclass
class OAuthTokens:
    access_token: str
    refresh_token: str | None
    expires_at: float | None
    client_id: str
    token_type: str = "Bearer"

    def is_valid(self) -> bool:
        if not self.access_token:
            return False
        if self.expires_at is None:
            return True
        return time.time() < (self.expires_at - TOKEN_EXPIRY_BUFFER_SEC)

    def to_dict(self) -> dict[str, Any]:
        return {
            "access_token": self.access_token,
            "refresh_token": self.refresh_token,
            "expires_at": self.expires_at,
            "client_id": self.client_id,
            "token_type": self.token_type,
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> OAuthTokens:
        return cls(
            access_token=data["access_token"],
            refresh_token=data.get("refresh_token"),
            expires_at=data.get("expires_at"),
            client_id=data["client_id"],
            token_type=data.get("token_type", "Bearer"),
        )


@dataclass
class PendingAuth:
    state: str
    code_verifier: str
    client_id: str
    redirect_uri: str


def generate_pkce() -> tuple[str, str]:
    verifier = base64.urlsafe_b64encode(secrets.token_bytes(32)).rstrip(b"=").decode("ascii")
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    challenge = base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")
    return verifier, challenge


def backend_url_from_mcp(mcp_url: str) -> str:
    parsed = urlsplit(mcp_url)
    return f"{parsed.scheme}://{parsed.netloc}"


def authorization_server_metadata_url(issuer: str) -> str:
    u = urlsplit(issuer.strip().rstrip("/"))
    issuer_path = u.path or ""
    if issuer_path in ("", "/"):
        meta_path = "/.well-known/oauth-authorization-server"
    else:
        meta_path = "/.well-known/oauth-authorization-server" + issuer_path
    return urlunsplit((u.scheme, u.netloc, meta_path, "", ""))


async def fetch_protected_resource_metadata(mcp_url: str) -> dict[str, Any] | None:
    async with httpx.AsyncClient(timeout=15.0) as client:
        for method in ("POST", "GET"):
            try:
                if method == "POST":
                    resp = await client.post(
                        mcp_url,
                        json={},
                        headers={"Accept": "application/json", "Content-Type": "application/json"},
                    )
                else:
                    resp = await client.get(mcp_url, headers={"Accept": "application/json"})
            except httpx.HTTPError:
                continue
            if resp.status_code != 401:
                continue
            www_auth = resp.headers.get("WWW-Authenticate", "")
            match = re.search(r'resource_metadata="([^"]+)"', www_auth)
            if not match:
                continue
            meta_resp = await client.get(match.group(1))
            meta_resp.raise_for_status()
            return meta_resp.json()
    return None


async def discover_oauth_metadata(mcp_url: str) -> tuple[dict[str, Any], str | None]:
    prm = await fetch_protected_resource_metadata(mcp_url)
    resource: str | None = None
    if prm:
        raw = prm.get("resource")
        resource = raw if isinstance(raw, str) else None
        servers = prm.get("authorization_servers")
        if isinstance(servers, list) and servers and isinstance(servers[0], str):
            meta_url = authorization_server_metadata_url(servers[0])
            async with httpx.AsyncClient(timeout=15.0) as client:
                resp = await client.get(meta_url)
                resp.raise_for_status()
                return resp.json(), resource

    backend = backend_url_from_mcp(mcp_url)
    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.get(f"{backend}/.well-known/oauth-authorization-server")
        resp.raise_for_status()
        metadata = resp.json()
    if resource is None and prm:
        raw = prm.get("resource")
        resource = raw if isinstance(raw, str) else None
    return metadata, resource


def _client_file() -> Path:
    return Path(__file__).parent / ".oauth_client.json"


def load_registered_client() -> dict[str, str] | None:
    path = _client_file()
    if not path.exists():
        return None
    data = json.loads(path.read_text())
    if data.get("redirect_uri") != settings.oauth_redirect_uri:
        return None
    return data


def save_registered_client(client_id: str) -> None:
    path = _client_file()
    path.write_text(
        json.dumps(
            {"client_id": client_id, "redirect_uri": settings.oauth_redirect_uri},
            indent=2,
        )
    )
    path.chmod(0o600)


async def ensure_client_registration(metadata: dict[str, Any]) -> str:
    stored = load_registered_client()
    if stored:
        return stored["client_id"]

    payload = {
        "client_name": settings.oauth_client_name,
        "redirect_uris": [settings.oauth_redirect_uri],
        "grant_types": ["authorization_code", "refresh_token"],
        "response_types": ["code"],
        "token_endpoint_auth_method": "none",
    }
    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.post(metadata["registration_endpoint"], json=payload)
        resp.raise_for_status()
        data = resp.json()

    client_id = data["client_id"]
    save_registered_client(client_id)
    logger.info("Registered OAuth client: %s", client_id)
    return client_id


def build_authorize_url(
    metadata: dict[str, Any],
    client_id: str,
    redirect_uri: str,
    state: str,
    code_challenge: str,
    resource: str | None,
) -> str:
    params: dict[str, str] = {
        "response_type": "code",
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "state": state,
        "code_challenge": code_challenge,
        "code_challenge_method": "S256",
    }
    if resource:
        params["resource"] = resource
    return f"{metadata['authorization_endpoint']}?{urlencode(params)}"


async def start_login() -> tuple[str, PendingAuth]:
    metadata, resource = await discover_oauth_metadata(settings.glean_mcp_url)
    client_id = await ensure_client_registration(metadata)
    code_verifier, code_challenge = generate_pkce()
    state = secrets.token_urlsafe(32)
    redirect_uri = settings.oauth_redirect_uri
    url = build_authorize_url(metadata, client_id, redirect_uri, state, code_challenge, resource)
    pending = PendingAuth(
        state=state,
        code_verifier=code_verifier,
        client_id=client_id,
        redirect_uri=redirect_uri,
    )
    return url, pending


async def finish_login(code: str, pending: PendingAuth) -> OAuthTokens:
    metadata, _ = await discover_oauth_metadata(settings.glean_mcp_url)
    payload = {
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": pending.redirect_uri,
        "client_id": pending.client_id,
        "code_verifier": pending.code_verifier,
    }
    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.post(metadata["token_endpoint"], data=payload)
        resp.raise_for_status()
        data = resp.json()

    expires_at = None
    if data.get("expires_in"):
        expires_at = time.time() + float(data["expires_in"])

    return OAuthTokens(
        access_token=data["access_token"],
        refresh_token=data.get("refresh_token"),
        expires_at=expires_at,
        client_id=pending.client_id,
        token_type=data.get("token_type", "Bearer"),
    )


async def refresh_tokens(tokens: OAuthTokens) -> OAuthTokens:
    if not tokens.refresh_token:
        raise RuntimeError("No refresh token available")

    metadata, _ = await discover_oauth_metadata(settings.glean_mcp_url)
    payload = {
        "grant_type": "refresh_token",
        "refresh_token": tokens.refresh_token,
        "client_id": tokens.client_id,
    }
    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.post(metadata["token_endpoint"], data=payload)
        resp.raise_for_status()
        data = resp.json()

    expires_at = tokens.expires_at
    if data.get("expires_in"):
        expires_at = time.time() + float(data["expires_in"])

    return OAuthTokens(
        access_token=data["access_token"],
        refresh_token=data.get("refresh_token", tokens.refresh_token),
        expires_at=expires_at,
        client_id=tokens.client_id,
        token_type=data.get("token_type", "Bearer"),
    )


async def ensure_valid_token(tokens: OAuthTokens | None) -> OAuthTokens | None:
    if tokens is None:
        return None
    if tokens.is_valid():
        return tokens
    if tokens.refresh_token:
        return await refresh_tokens(tokens)
    return None
