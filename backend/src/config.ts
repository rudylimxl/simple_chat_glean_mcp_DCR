import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";

const backendRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
loadEnv({ path: join(backendRoot, ".env") });

export const settings = {
  gleanMcpUrl: process.env.GLEAN_MCP_URL ?? "",
  gleanMcpToken: process.env.GLEAN_MCP_TOKEN ?? "",
  mcpTool: process.env.MCP_TOOL ?? "chat",
  frontendUrl: process.env.FRONTEND_URL ?? "http://localhost:5174",
  oauthRedirectUri:
    process.env.OAUTH_REDIRECT_URI ?? "http://localhost:8001/api/auth/callback",
  oauthClientName: process.env.OAUTH_CLIENT_NAME ?? "MCP Chatbot",
  sessionSecret: process.env.SESSION_SECRET ?? randomBytes(24).toString("base64url"),
  host: process.env.HOST ?? "0.0.0.0",
  port: Number(process.env.PORT ?? 8001),
  oauthClientFile: join(backendRoot, ".oauth_client.json"),
};
