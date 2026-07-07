import { createHash, randomBytes } from "node:crypto";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { settings } from "./config.js";

const TOKEN_EXPIRY_BUFFER_SEC = 300;

export interface OAuthTokens {
  access_token: string;
  refresh_token: string | null;
  expires_at: number | null;
  client_id: string;
  token_type: string;
}

export interface PendingAuth {
  state: string;
  code_verifier: string;
  client_id: string;
  redirect_uri: string;
}

export function tokensFromDict(data: Record<string, unknown>): OAuthTokens {
  return {
    access_token: String(data.access_token),
    refresh_token: data.refresh_token != null ? String(data.refresh_token) : null,
    expires_at: typeof data.expires_at === "number" ? data.expires_at : null,
    client_id: String(data.client_id),
    token_type: typeof data.token_type === "string" ? data.token_type : "Bearer",
  };
}

export function tokensToDict(tokens: OAuthTokens): Record<string, unknown> {
  return {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expires_at: tokens.expires_at,
    client_id: tokens.client_id,
    token_type: tokens.token_type,
  };
}

export function isTokenValid(tokens: OAuthTokens): boolean {
  if (!tokens.access_token) return false;
  if (tokens.expires_at == null) return true;
  return Date.now() / 1000 < tokens.expires_at - TOKEN_EXPIRY_BUFFER_SEC;
}

export function generatePkce(): [string, string] {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return [verifier, challenge];
}

function backendUrlFromMcp(mcpUrl: string): string {
  const parsed = new URL(mcpUrl);
  return `${parsed.protocol}//${parsed.host}`;
}

function authorizationServerMetadataUrl(issuer: string): string {
  const parsed = new URL(issuer.trim().replace(/\/$/, ""));
  const issuerPath = parsed.pathname || "";
  const metaPath =
    issuerPath === "" || issuerPath === "/"
      ? "/.well-known/oauth-authorization-server"
      : `/.well-known/oauth-authorization-server${issuerPath}`;
  return `${parsed.origin}${metaPath}`;
}

async function fetchProtectedResourceMetadata(
  mcpUrl: string,
): Promise<Record<string, unknown> | null> {
  for (const method of ["POST", "GET"] as const) {
    try {
      const init: RequestInit =
        method === "POST"
          ? {
              method: "POST",
              headers: {
                Accept: "application/json",
                "Content-Type": "application/json",
              },
              body: "{}",
            }
          : { headers: { Accept: "application/json" } };

      const resp = await fetch(mcpUrl, init);
      if (resp.status !== 401) continue;

      const wwwAuth = resp.headers.get("WWW-Authenticate") ?? "";
      const match = /resource_metadata="([^"]+)"/.exec(wwwAuth);
      if (!match) continue;

      const metaResp = await fetch(match[1]);
      if (!metaResp.ok) continue;
      return (await metaResp.json()) as Record<string, unknown>;
    } catch {
      continue;
    }
  }
  return null;
}

async function discoverOAuthMetadata(
  mcpUrl: string,
): Promise<[Record<string, unknown>, string | null]> {
  const prm = await fetchProtectedResourceMetadata(mcpUrl);
  let resource: string | null = null;

  if (prm) {
    if (typeof prm.resource === "string") resource = prm.resource;
    const servers = prm.authorization_servers;
    if (Array.isArray(servers) && typeof servers[0] === "string") {
      const metaUrl = authorizationServerMetadataUrl(servers[0]);
      const resp = await fetch(metaUrl);
      if (!resp.ok) throw new Error(`OAuth metadata fetch failed: ${resp.status}`);
      return [(await resp.json()) as Record<string, unknown>, resource];
    }
  }

  const backend = backendUrlFromMcp(mcpUrl);
  const resp = await fetch(`${backend}/.well-known/oauth-authorization-server`);
  if (!resp.ok) throw new Error(`OAuth metadata fetch failed: ${resp.status}`);
  const metadata = (await resp.json()) as Record<string, unknown>;
  if (resource == null && prm && typeof prm.resource === "string") {
    resource = prm.resource;
  }
  return [metadata, resource];
}

function loadRegisteredClient(): { client_id: string; redirect_uri: string } | null {
  if (!existsSync(settings.oauthClientFile)) return null;
  const data = JSON.parse(readFileSync(settings.oauthClientFile, "utf8")) as {
    client_id?: string;
    redirect_uri?: string;
  };
  if (data.redirect_uri !== settings.oauthRedirectUri || !data.client_id) return null;
  return { client_id: data.client_id, redirect_uri: data.redirect_uri };
}

function saveRegisteredClient(clientId: string): void {
  writeFileSync(
    settings.oauthClientFile,
    JSON.stringify(
      { client_id: clientId, redirect_uri: settings.oauthRedirectUri },
      null,
      2,
    ),
  );
  chmodSync(settings.oauthClientFile, 0o600);
}

async function ensureClientRegistration(metadata: Record<string, unknown>): Promise<string> {
  const stored = loadRegisteredClient();
  if (stored) return stored.client_id;

  const registrationEndpoint = metadata.registration_endpoint;
  if (typeof registrationEndpoint !== "string") {
    throw new Error("OAuth metadata missing registration_endpoint");
  }

  const resp = await fetch(registrationEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_name: settings.oauthClientName,
      redirect_uris: [settings.oauthRedirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    }),
  });
  if (!resp.ok) throw new Error(`Client registration failed: ${resp.status}`);
  const data = (await resp.json()) as { client_id?: string };
  if (!data.client_id) throw new Error("Client registration missing client_id");

  saveRegisteredClient(data.client_id);
  return data.client_id;
}

function buildAuthorizeUrl(
  metadata: Record<string, unknown>,
  clientId: string,
  redirectUri: string,
  state: string,
  codeChallenge: string,
  resource: string | null,
): string {
  const authorizationEndpoint = metadata.authorization_endpoint;
  if (typeof authorizationEndpoint !== "string") {
    throw new Error("OAuth metadata missing authorization_endpoint");
  }

  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });
  if (resource) params.set("resource", resource);
  return `${authorizationEndpoint}?${params}`;
}

export async function startLogin(
  mcpUrl: string,
): Promise<[string, PendingAuth]> {
  const [metadata, resource] = await discoverOAuthMetadata(mcpUrl);
  const clientId = await ensureClientRegistration(metadata);
  const [codeVerifier, codeChallenge] = generatePkce();
  const state = randomBytes(24).toString("base64url");
  const redirectUri = settings.oauthRedirectUri;
  const url = buildAuthorizeUrl(
    metadata,
    clientId,
    redirectUri,
    state,
    codeChallenge,
    resource,
  );
  return [
    url,
    {
      state,
      code_verifier: codeVerifier,
      client_id: clientId,
      redirect_uri: redirectUri,
    },
  ];
}

export async function finishLogin(
  code: string,
  pending: PendingAuth,
  mcpUrl: string,
): Promise<OAuthTokens> {
  const [metadata] = await discoverOAuthMetadata(mcpUrl);
  const tokenEndpoint = metadata.token_endpoint;
  if (typeof tokenEndpoint !== "string") {
    throw new Error("OAuth metadata missing token_endpoint");
  }

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: pending.redirect_uri,
    client_id: pending.client_id,
    code_verifier: pending.code_verifier,
  });

  const resp = await fetch(tokenEndpoint, { method: "POST", body });
  if (!resp.ok) throw new Error(`Token exchange failed: ${resp.status}`);
  const data = (await resp.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
    token_type?: string;
  };

  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token ?? null,
    expires_at:
      data.expires_in != null ? Date.now() / 1000 + Number(data.expires_in) : null,
    client_id: pending.client_id,
    token_type: data.token_type ?? "Bearer",
  };
}

export async function refreshTokens(
  tokens: OAuthTokens,
  mcpUrl: string,
): Promise<OAuthTokens> {
  if (!tokens.refresh_token) throw new Error("No refresh token available");

  const [metadata] = await discoverOAuthMetadata(mcpUrl);
  const tokenEndpoint = metadata.token_endpoint;
  if (typeof tokenEndpoint !== "string") {
    throw new Error("OAuth metadata missing token_endpoint");
  }

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: tokens.refresh_token,
    client_id: tokens.client_id,
  });

  const resp = await fetch(tokenEndpoint, { method: "POST", body });
  if (!resp.ok) throw new Error(`Token refresh failed: ${resp.status}`);
  const data = (await resp.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
    token_type?: string;
  };

  return {
    access_token: data.access_token,
    refresh_token: data.refresh_token ?? tokens.refresh_token,
    expires_at:
      data.expires_in != null
        ? Date.now() / 1000 + Number(data.expires_in)
        : tokens.expires_at,
    client_id: tokens.client_id,
    token_type: data.token_type ?? tokens.token_type,
  };
}

export async function ensureValidToken(
  tokens: OAuthTokens | null,
  mcpUrl: string,
): Promise<OAuthTokens | null> {
  if (!tokens) return null;
  if (isTokenValid(tokens)) return tokens;
  if (tokens.refresh_token) return refreshTokens(tokens, mcpUrl);
  return null;
}
