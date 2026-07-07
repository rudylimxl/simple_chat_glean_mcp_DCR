import { randomBytes } from "node:crypto";
import cors from "cors";
import express from "express";
import session from "express-session";
import { handleChat, type ChatMessage } from "./chat-handler.js";
import { settings } from "./config.js";
import {
  ensureValidToken,
  finishLogin,
  isTokenValid,
  startLogin,
  tokensFromDict,
  tokensToDict,
  type OAuthTokens,
  type PendingAuth,
} from "./oauth-service.js";
import { sessionMcp } from "./session-mcp.js";

declare module "express-session" {
  interface SessionData {
    sid?: string;
    oauth?: Record<string, unknown>;
    oauth_pending?: PendingAuth;
    glean_mcp_url?: string;
  }
}

const OAUTH_SESSION_KEY = "oauth";
const PENDING_SESSION_KEY = "oauth_pending";
const MCP_URL_SESSION_KEY = "glean_mcp_url";

function sessionId(req: express.Request): string {
  if (!req.session.sid) {
    req.session.sid = randomBytes(12).toString("base64url");
  }
  return req.session.sid;
}

function getMcpUrl(req: express.Request): string {
  return (req.session[MCP_URL_SESSION_KEY] || settings.gleanMcpUrl || "").replace(/\/$/, "");
}

function getTokens(req: express.Request): OAuthTokens | null {
  const raw = req.session[OAUTH_SESSION_KEY];
  if (!raw || typeof raw !== "object") return null;
  return tokensFromDict(raw as Record<string, unknown>);
}

function setTokens(req: express.Request, tokens: OAuthTokens): void {
  req.session[OAUTH_SESSION_KEY] = tokensToDict(tokens);
}

const app = express();

app.use(
  cors({
    origin: [
      settings.frontendUrl,
      "http://localhost:5174",
      "http://localhost:3000",
      "http://127.0.0.1:5174",
    ],
    credentials: true,
  }),
);
app.use(express.json());
app.use(
  session({
    secret: settings.sessionSecret,
    resave: false,
    saveUninitialized: true,
    cookie: {
      httpOnly: true,
      secure: false,
      sameSite: "lax",
    },
  }),
);

app.get("/api/config", (req, res) => {
  const url = getMcpUrl(req);
  res.json({ glean_mcp_url: url || null });
});

app.post("/api/config", async (req, res) => {
  const url = String(req.body?.glean_mcp_url ?? "").trim().replace(/\/$/, "");
  if (!url) {
    res.status(400).json({ detail: "Glean MCP URL is required" });
    return;
  }
  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    res.status(400).json({ detail: "URL must start with http:// or https://" });
    return;
  }

  const previous = req.session[MCP_URL_SESSION_KEY];
  if (previous !== url) {
    await sessionMcp.remove(sessionId(req));
    delete req.session[OAUTH_SESSION_KEY];
  }

  req.session[MCP_URL_SESSION_KEY] = url;
  res.json({ glean_mcp_url: url });
});

app.get("/api/health", async (req, res) => {
  const mcpUrl = getMcpUrl(req);
  const tokens = getTokens(req);
  const authenticated =
    Boolean(tokens && isTokenValid(tokens)) || Boolean(settings.gleanMcpToken);
  let mcpStatus: Record<string, unknown> = {
    connected: false,
    tool_count: 0,
    primary_tool: null,
  };

  if (mcpUrl && authenticated) {
    try {
      const access = settings.gleanMcpToken || tokens?.access_token || "";
      const client = await sessionMcp.get(sessionId(req), access, mcpUrl);
      mcpStatus = client.status();
    } catch (err) {
      console.error("MCP health check failed", err);
    }
  }

  res.json({
    status: "ok",
    mcp_configured: Boolean(mcpUrl),
    glean_mcp_url: mcpUrl || null,
    authenticated,
    auth_mode: settings.gleanMcpToken ? "token" : "oauth",
    mcp: mcpStatus,
  });
});

app.get("/api/auth/login", async (req, res) => {
  if (settings.gleanMcpToken) {
    res.redirect(settings.frontendUrl);
    return;
  }

  const mcpUrl = getMcpUrl(req);
  if (!mcpUrl) {
    res.status(400).json({ detail: "Set Glean MCP URL first" });
    return;
  }

  try {
    const [authorizeUrl, pending] = await startLogin(mcpUrl);
    req.session[PENDING_SESSION_KEY] = pending;
    res.redirect(authorizeUrl);
  } catch (err) {
    console.error("OAuth login start failed", err);
    res.status(503).json({ detail: String(err) });
  }
});

app.get("/api/auth/callback", async (req, res) => {
  const error = typeof req.query.error === "string" ? req.query.error : null;
  if (error) {
    res.redirect(`${settings.frontendUrl}?auth_error=${encodeURIComponent(error)}`);
    return;
  }

  const code = typeof req.query.code === "string" ? req.query.code : null;
  const state = typeof req.query.state === "string" ? req.query.state : null;
  if (!code || !state) {
    res.status(400).json({ detail: "Missing code or state" });
    return;
  }

  const mcpUrl = getMcpUrl(req);
  if (!mcpUrl) {
    res.redirect(`${settings.frontendUrl}?auth_error=mcp_url_missing`);
    return;
  }

  const pendingRaw = req.session[PENDING_SESSION_KEY];
  delete req.session[PENDING_SESSION_KEY];
  if (!pendingRaw || pendingRaw.state !== state) {
    res.status(400).json({ detail: "Invalid OAuth state" });
    return;
  }

  try {
    const tokens = await finishLogin(code, pendingRaw, mcpUrl);
    setTokens(req, tokens);
    res.redirect(settings.frontendUrl);
  } catch (err) {
    console.error("OAuth token exchange failed", err);
    res.redirect(`${settings.frontendUrl}?auth_error=token_exchange_failed`);
  }
});

app.post("/api/auth/logout", async (req, res) => {
  await sessionMcp.remove(sessionId(req));
  delete req.session[OAUTH_SESSION_KEY];
  res.json({ status: "ok" });
});

async function resolveMcpClient(req: express.Request) {
  const mcpUrl = getMcpUrl(req);
  if (!mcpUrl) {
    const err = new Error("Set Glean MCP URL first") as Error & { status?: number };
    err.status = 400;
    throw err;
  }

  if (settings.gleanMcpToken) {
    return sessionMcp.get(sessionId(req), settings.gleanMcpToken, mcpUrl);
  }

  let tokens = getTokens(req);
  tokens = await ensureValidToken(tokens, mcpUrl);
  if (!tokens) {
    const err = new Error("Not signed in. Visit /api/auth/login.") as Error & { status?: number };
    err.status = 401;
    throw err;
  }

  setTokens(req, tokens);
  return sessionMcp.get(sessionId(req), tokens.access_token, mcpUrl);
}

app.post("/api/chat", async (req, res) => {
  if (!getMcpUrl(req)) {
    res.status(400).json({ detail: "Set Glean MCP URL first" });
    return;
  }

  let mcpClient;
  try {
    mcpClient = await resolveMcpClient(req);
  } catch (err) {
    const status = (err as { status?: number }).status ?? 503;
    res.status(status).json({ detail: String(err) });
    return;
  }

  const messages = (req.body?.messages ?? []) as ChatMessage[];

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  try {
    for await (const event of handleChat(mcpClient, messages)) {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    }
    res.write("event: done\ndata: {}\n\n");
  } catch (err) {
    console.error("Chat error", err);
    res.write(
      `data: ${JSON.stringify({ type: "error", content: String(err) })}\n\n`,
    );
  } finally {
    res.end();
  }
});

const server = app.listen(settings.port, settings.host, () => {
  console.log(`MCP Chatbot backend listening on http://${settings.host}:${settings.port}`);
});

async function shutdown() {
  await sessionMcp.disconnectAll();
  server.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
