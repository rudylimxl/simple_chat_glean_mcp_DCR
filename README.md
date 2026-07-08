# MCP Chatbot

A chat UI that looks like a normal assistant but always answers by calling Glean MCP on the backend. No Glean SDK in the browser, no LLM — every question goes straight to Glean's `chat` tool.

Paste your Glean MCP URL on the Sign in page.

![Paste Glean MCP URL](docs/home.png)

The main app has a mock dashboard with always-on Glean assistant on the right panel. Start asking questions right away!
![Trading desk dashboard with Glean Assistant chat](docs/screenshot.png)

## Running it

```bash
npm install
cp backend/.env.example backend/.env   # only SESSION_SECRET required
npm run dev
```

(`npm run dev` and `npm start` run the Node.js backend and Vite frontend together. Root scripts also delegate to `frontend/` and `backend/` for build/preview. You can still run each side on its own with `npm run dev:backend` or `npm run dev:frontend`.)

Open http://localhost:5174 → paste your **Glean MCP URL** on the home page → **Continue to chat** → **Sign in** → ask something.

Your MCP URL comes from Glean Admin → Platform → Glean MCP server (e.g. `https://your-tenant-be.glean.com/mcp/default`). No need to put it in `.env`.

### Troubleshooting: `No module named 'httpcore'`

That error means the frontend is talking to a **stale Python backend** on port `8001`, not the Node.js backend in this repo. This usually happens if you ran the old Python version before and never stopped it.

1. Stop whatever is on port 8001:

   ```bash
   lsof -ti :8001 | xargs kill
   ```

2. Confirm nothing is listening:

   ```bash
   lsof -i :8001
   ```

3. Start fresh:

   ```bash
   npm run dev
   ```

4. Verify the backend is Node (not uvicorn):

   ```bash
   curl -I http://localhost:8001/api/health
   ```

   You should **not** see `server: uvicorn` in the response headers.

### Troubleshooting: `TypeError: fetch failed`

The Node backend couldn't reach your Glean MCP URL over HTTPS. Common causes:

1. **Wrong MCP URL** — copy it exactly from Glean Admin → Platform → Glean MCP server.
2. **VPN required** — connect to your company VPN, then retry sign-in.
3. **TLS / proxy issues** — restart with `npm run dev` (the backend uses system certificates). If it still fails, check corporate proxy or SSL inspection settings.

### Troubleshooting: OAuth client does not exist

The backend caches a dynamically registered OAuth client in `backend/.oauth_client.json`. If you see "The requested OAuth 2.0 Client does not exist", delete that file and sign in again:

```bash
rm backend/.oauth_client.json
```

Then restart `npm run dev` and click **Sign in** — a fresh client will be registered for your Glean instance.

```
┌─────────────┐     SSE      ┌──────────────┐    MCP/HTTP    ┌─────────────────┐
│  React UI   │ ◄──────────► │ Node.js      │ ◄────────────► │ Glean MCP       │
│  (Vite)     │   + cookies  │ + OAuth DCR  │  Bearer token  │ (chat tool)     │
└─────────────┘              └──────────────┘                └─────────────────┘
```

## What we're building

I wanted the simplest possible demo of "chatbot UI → MCP tool call" without wiring up a model or embedding Glean in the frontend.

| Piece            | What it does                                                    |
| ---------------- | --------------------------------------------------------------- |
| React frontend   | Home page for MCP URL, chat UI, sign in, read the reply         |
| Node.js backend  | OAuth, session management, MCP connection, tool calls           |
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

This is intentionally dumber than [vertex-mcp-chat](../vertex-mcp-chat). Glean Assistant *is* the answer — we're just wrapping it in a chat UI. One user message → one MCP tool call → one reply.

### MCP URL on the home page

The Glean MCP URL is stored per session via the web UI, not hardcoded in `.env`. Click **Home** (top right) anytime to change it. Changing the URL clears your OAuth session so you can sign in against a different instance.

### MCP stays in the backend

Glean MCP is HTTP, not stdio. The browser shouldn't hold OAuth tokens or speak MCP directly.

| Concern      | Approach                                                         |
| ------------ | ---------------------------------------------------------------- |
| Transport    | Streamable HTTP from the MCP TypeScript SDK                      |
| Auth         | Per-user OAuth tokens, passed as Bearer on MCP requests          |
| Frontend     | SSE events + session cookies — no MCP protocol in the browser    |
| Connections  | One MCP session per signed-in user, cached and reused            |

### OAuth instead of a static API token

Users sign in with their own Glean account so MCP calls inherit their permissions. The flow uses Dynamic Client Registration + PKCE — standard MCP OAuth.

Set `GLEAN_MCP_TOKEN` in `.env` to skip OAuth entirely (headless testing only).

### Streaming

SSE, not WebSockets — one-directional server → browser, works through Vite's dev proxy. Events: `status`, `text`, `error`.

## Repo layout

| Path                                 | Purpose                                      |
| ------------------------------------ | -------------------------------------------- |
| `backend/src/index.ts`               | Express server, OAuth routes, SSE chat endpoint |
| `backend/src/oauth-service.ts`       | DCR, PKCE, token exchange and refresh        |
| `backend/src/mcp-client.ts`          | Glean MCP connection with user's bearer token |
| `backend/src/chat-handler.ts`        | Always calls `chat` (or `search`) each turn  |
| `frontend/src/components/Home.tsx`   | MCP URL input                                |
| `frontend/src/components/Chat.tsx`   | Chat UI + sign-in gate                       |

## Config (`backend/.env`)

Optional — defaults work for local dev.

| Variable             | What it's for                                                         |
| -------------------- | --------------------------------------------------------------------- |
| `SESSION_SECRET`     | Signs session cookies (set this in `.env`)                            |
| `GLEAN_MCP_URL`      | Optional fallback URL — normally set via the home page                  |
| `GLEAN_MCP_TOKEN`    | Optional dev bypass — skip OAuth                                      |
| `FRONTEND_URL`       | Post-OAuth redirect (default `http://localhost:5174`)                 |
| `OAUTH_REDIRECT_URI` | Backend callback (default `http://localhost:8001/api/auth/callback`)  |
