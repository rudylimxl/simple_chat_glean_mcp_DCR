import { GleanMcpClient } from "./mcp-client.js";

class SessionMcpRegistry {
  private clients = new Map<string, GleanMcpClient>();

  async get(sessionId: string, accessToken: string, mcpUrl: string): Promise<GleanMcpClient> {
    const existing = this.clients.get(sessionId);
    if (
      existing &&
      existing.hasToken(accessToken) &&
      existing.hasMcpUrl(mcpUrl) &&
      existing.isConnected()
    ) {
      return existing;
    }

    if (existing) await existing.disconnect();

    const client = new GleanMcpClient();
    await client.connect(accessToken, mcpUrl);
    this.clients.set(sessionId, client);
    return client;
  }

  async remove(sessionId: string): Promise<void> {
    const client = this.clients.get(sessionId);
    if (client) {
      await client.disconnect();
      this.clients.delete(sessionId);
    }
  }

  async disconnectAll(): Promise<void> {
    for (const sessionId of [...this.clients.keys()]) {
      await this.remove(sessionId);
    }
  }
}

export const sessionMcp = new SessionMcpRegistry();
