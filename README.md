# MCP Chatbot

A chat UI that looks like a normal assistant but always answers by calling Glean MCP on the backend. No Glean SDK in the browser, no LLM deciding whether to search — every question goes straight to Glean's `chat` tool.

```
┌─────────────┐     SSE      ┌──────────────┐    MCP/HTTP    ┌─────────────────┐
│  React UI   │ ◄──────────► │ FastAPI      │ ◄────────────► │ Glean MCP       │
│  (Vite)     │   + cookies  │ + OAuth DCR  │  Bearer token  │ (chat tool)     │
└─────────────┘              └──────────────┘                └─────────────────┘
```

## What we're building

I wanted the simplest possible demo of "chatbot UI → MCP tool call" without wiring up a model or embedding Glean in the frontend.

| Piece            | What it does                                                    |
| ---------------- | --------------------------------------------------------------- |
| React frontend   | Generic assistant UI — sign in, type a message, read the reply |
| FastAPI backend  | OAuth, session management, MCP connection, tool calls           |
| Glean MCP        | Actually answers the question via the `chat` tool               |

The frontend doesn't know it's talking to Glean. It just hits `/api/chat` and shows whatever comes back.

## How it fits together

**A typical turn:**

| Step | What happens                                                              |
| ---- | ------------------------------------------------------------------------- |
| 1    | User sends a message                                                      |
| 2    | Backend calls Glean MCP `chat` with the message + prior history as context |
| 3    | Status shows "Asking Glean..." while the tool runs                        |
| 4    | Tool result streams back as the assistant reply                           |

No agent loop, no tool selection. The backend always calls `chat` (falls back to `search` if that's all the server exposes).

## Decisions

### No LLM in the loop

This is intentionally dumber than [vertex-mcp-chat](../vertex-mcp-chat). There's no Vertex endpoint, no model deciding *when* to call tools. Glean Assistant *is* the answer — we're just wrapping it in a chat UI.

That makes the demo easier to reason about: one user message → one MCP tool call → one reply.

### MCP stays in the backend

Glean MCP is HTTP, not stdio. The browser shouldn't hold OAuth tokens or know the MCP server URL.

| Concern      | Approach                                                         |
| ------------ | ---------------------------------------------------------------- |
| Transport    | Streamable HTTP from the Python MCP SDK                          |
| Auth         | Per-user OAuth tokens, passed as Bearer on MCP requests          |
| Frontend     | SSE events + session cookies — no MCP protocol in the browser    |
| Connections  | One MCP session per signed-in user, cached and reused            |

### OAuth instead of a static API token

Hardcoding `GLEAN_MCP_TOKEN` in `.env` works for quick testing, but it's not how a real app should authenticate. Users should sign in with their own Glean account so MCP calls inherit their permissions.

The flow follows the standard MCP OAuth pattern:

1. Probe the MCP URL → get a 401 → discover OAuth metadata (RFC 9728 protected-resource metadata → authorization server)
2. **Dynamic Client Registration** — register this app as an OAuth client on first login (redirect URI: `http://localhost:8001/api/auth/callback`)
3. **PKCE** — redirect the user to Glean login, exchange the code for access + refresh tokens
4. Store tokens in a signed session cookie; refresh automatically when they expire

Set `GLEAN_MCP_TOKEN` in `.env` to skip OAuth entirely — useful for headless testing, not for production.

### Generic frontend

The UI says "Assistant", not "Glean". No Web SDK, no embedded search widget. It's meant to look like any other chatbot while Glean does the work behind the scenes.

### Streaming

SSE, not WebSockets — the stream is one-directional (server → browser) and works through Vite's dev proxy without extra config. The only events the UI cares about are `status`, `text`, and `error`.

## Repo layout

| Path                                 | Purpose                                      |
| ------------------------------------ | -------------------------------------------- |
| `backend/main.py`                    | FastAPI, OAuth routes, SSE chat endpoint     |
| `backend/oauth_service.py`           | DCR, PKCE, token exchange and refresh        |
| `backend/mcp_client.py`              | Glean MCP connection with user's bearer token |
| `backend/chat_handler.py`            | Always calls `chat` (or `search`) each turn  |
| `backend/session_mcp.py`             | Per-session MCP connection cache             |
| `frontend/src/components/Chat.tsx`   | Chat UI + sign-in gate                       |

## Config

### Runtime (`backend/.env`)

| Variable             | What it's for                                                         |
| -------------------- | --------------------------------------------------------------------- |
| `GLEAN_MCP_URL`      | Glean MCP server URL (tenant-be.glean.com/mcp/path)                   |
| `SESSION_SECRET`     | Signs session cookies — use a random string                           |
| `FRONTEND_URL`       | Post-OAuth redirect (default http://localhost:5174)                   |
| `OAUTH_REDIRECT_URI` | Backend callback (default http://localhost:8001/api/auth/callback)    |
| `GLEAN_MCP_TOKEN`    | Optional dev bypass — leave empty for OAuth                           |
| `MCP_TOOL`           | Tool called each turn (default chat)                                  |

## Running it

**Prerequisites:** Glean MCP enabled in admin, DCR allowed for your instance.

| Step | Command                                                              |
| ---- | -------------------------------------------------------------------- |
| 1    | cd backend && python -m venv .venv && source .venv/bin/activate      |
| 2    | pip install -r requirements.txt                                      |
| 3    | cp .env.example .env — set GLEAN_MCP_URL and SESSION_SECRET          |
| 4    | python main.py                                                       |
| 5    | cd frontend && npm install && npm run dev (separate terminal)        |

Open http://localhost:5174, click **Sign in**, and ask something.
