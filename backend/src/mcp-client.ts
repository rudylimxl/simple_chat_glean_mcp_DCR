import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { settings } from "./config.js";
import { systemFetch } from "./errors.js";

export interface ToolInfo {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface ToolCallResult {
  text: string;
  raw: Record<string, unknown>;
}

export class GleanMcpClient {
  private client: Client | null = null;
  private transport: StreamableHTTPClientTransport | null = null;
  private tools: ToolInfo[] = [];
  private connected = false;
  private accessToken: string | null = null;
  private mcpUrl: string | null = null;

  hasToken(accessToken: string): boolean {
    return this.accessToken === accessToken;
  }

  hasMcpUrl(mcpUrl: string): boolean {
    return this.mcpUrl === mcpUrl.replace(/\/$/, "");
  }

  isConnected(): boolean {
    return this.connected;
  }

  async connect(accessToken?: string | null, mcpUrl?: string | null): Promise<void> {
    if (this.connected) return;

    const url = (mcpUrl || settings.gleanMcpUrl || "").replace(/\/$/, "");
    if (!url) throw new Error("Glean MCP URL not configured");

    const token = accessToken || settings.gleanMcpToken;
    if (!token) throw new Error("No access token — sign in first");

    this.transport = new StreamableHTTPClientTransport(new URL(url), {
      fetch: systemFetch,
      requestInit: {
        headers: { Authorization: `Bearer ${token}` },
      },
    });

    this.client = new Client({ name: "mcp-chatbot", version: "0.1.0" });
    await this.client.connect(this.transport);

    const result = await this.client.listTools();
    this.tools = result.tools.map((tool) => ({
      name: tool.name,
      description: tool.description ?? "",
      input_schema:
        tool.inputSchema && typeof tool.inputSchema === "object"
          ? (tool.inputSchema as Record<string, unknown>)
          : {},
    }));

    this.accessToken = token;
    this.mcpUrl = url;
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    await this.client?.close();
    this.client = null;
    this.transport = null;
    this.tools = [];
    this.connected = false;
    this.accessToken = null;
    this.mcpUrl = null;
  }

  resolveTool(preferred?: string | null): string {
    const names = new Set(this.tools.map((t) => t.name));
    const candidates = [preferred || settings.mcpTool, "chat", "search", "glean_search"];
    for (const name of candidates) {
      if (name && names.has(name)) return name;
    }
    if (this.tools.length > 0) return this.tools[0].name;
    throw new Error("No MCP tools available");
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<ToolCallResult> {
    if (!this.client) throw new Error("MCP not connected");

    const result = await this.client.callTool({ name, arguments: args });
    const raw =
      result && typeof result === "object"
        ? (result as Record<string, unknown>)
        : { content: result };

    const parts: string[] = [];
    if (Array.isArray(raw.content)) {
      for (const block of raw.content) {
        if (
          block &&
          typeof block === "object" &&
          "text" in block &&
          typeof block.text === "string"
        ) {
          parts.push(block.text);
        } else {
          parts.push(String(block));
        }
      }
    }

    const text =
      parts.length > 0
        ? parts.join("\n")
        : JSON.stringify({ status: "ok", isError: raw.isError ?? false });

    return { text, raw };
  }

  status(): Record<string, unknown> {
    return {
      connected: this.connected,
      tool_count: this.tools.length,
      primary_tool: this.tools.length > 0 ? this.resolveTool() : null,
      tools: this.tools.map((t) => ({
        name: t.name,
        description: t.description.slice(0, 100),
      })),
    };
  }
}
