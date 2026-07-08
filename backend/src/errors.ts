import { Agent, fetch as undiciFetch } from "undici";
import { getCACertificates } from "node:tls";

let dispatcher: Agent | undefined;

function getDispatcher(): Agent {
  if (!dispatcher) {
    dispatcher = new Agent({
      connect: {
        ca: [...getCACertificates("default"), ...getCACertificates("system")],
      },
    });
  }
  return dispatcher;
}

export async function systemFetch(
  input: string | URL,
  init?: RequestInit,
): Promise<Response> {
  return undiciFetch(input, {
    ...init,
    dispatcher: getDispatcher(),
  }) as unknown as Response;
}

export function formatError(err: unknown): string {
  if (!(err instanceof Error)) return String(err);

  const cause = err.cause;
  if (cause instanceof Error) {
    const code = "code" in cause && typeof cause.code === "string" ? cause.code : null;

    if (code === "UNABLE_TO_GET_ISSUER_CERT_LOCALLY") {
      return "TLS certificate verification failed reaching Glean. Check VPN/proxy settings, or contact your IT team about SSL inspection.";
    }
    if (code === "ENOTFOUND") {
      const host =
        "hostname" in cause && typeof cause.hostname === "string"
          ? cause.hostname
          : cause.message;
      return `Could not resolve Glean host (${host}). Check the MCP URL.`;
    }
    if (code === "ECONNREFUSED") {
      return "Connection refused by Glean MCP server. Check the MCP URL and network.";
    }
    if (code) return `${code}: ${cause.message}`;
    return cause.message;
  }

  if (err.message === "fetch failed" && err.cause == null) {
    return "Network request to Glean failed. Check the MCP URL, VPN, and internet connection.";
  }

  return err.message;
}

export async function fetchJson(
  input: string,
  init?: RequestInit,
): Promise<{ ok: true; data: Record<string, unknown> } | { ok: false; status: number }> {
  try {
    const resp = await systemFetch(input, init);
    if (!resp.ok) return { ok: false, status: resp.status };
    return { ok: true, data: (await resp.json()) as Record<string, unknown> };
  } catch (err) {
    throw new Error(formatError(err), { cause: err });
  }
}
