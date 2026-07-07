import type { GleanMcpClient } from "./mcp-client.js";

const FOOTNOTE_DEF = /^\[\^(\d+)\]:\s*\[([^\]]*)\]\(([^)]+)\)\s*$/gm;
const CHAT_METADATA = /\n---\nchatId:.*/s;
const FOLLOWUP_BLOCK = /\n---\n(?!chatId:)(.+?)(?=\n\[\^\d+\]:|\n---\nchatId:|$)/s;

export interface ChatMessage {
  role: string;
  content: string;
}

export interface ChatEvent {
  type: string;
  content?: string;
  name?: string;
  arguments?: Record<string, unknown>;
  raw?: Record<string, unknown>;
  citations?: Array<{ id: string; title: string; url: string }>;
}

function parseResponse(text: string): [
  string,
  Array<{ id: string; title: string; url: string }>,
] {
  const citations: Array<{ id: string; title: string; url: string }> = [];
  for (const match of text.matchAll(FOOTNOTE_DEF)) {
    citations.push({
      id: match[1],
      title: match[2].trim(),
      url: match[3].trim(),
    });
  }

  let body = text.replace(CHAT_METADATA, "");
  body = body.replace(FOOTNOTE_DEF, "");
  body = body.replace(FOLLOWUP_BLOCK, "");
  body = body.replace(/\n{3,}/g, "\n\n").trim();
  return [body, citations];
}

function buildChatArgs(
  toolName: string,
  userMessage: string,
  history: ChatMessage[],
): Record<string, unknown> {
  if (toolName === "chat") {
    const context = history
      .filter((m) => (m.role === "user" || m.role === "assistant") && m.content.trim())
      .map((m) => `${m.role}: ${m.content}`);
    const args: Record<string, unknown> = { message: userMessage };
    if (context.length > 0) args.context = context;
    return args;
  }

  if (toolName === "search" || toolName === "glean_search") {
    return { query: userMessage };
  }

  return { message: userMessage, query: userMessage };
}

export async function* handleChat(
  mcp: GleanMcpClient,
  messages: ChatMessage[],
): AsyncGenerator<ChatEvent> {
  const userMessages = messages.filter((m) => m.role === "user");
  if (userMessages.length === 0) {
    yield { type: "error", content: "No user message provided." };
    return;
  }

  const userMessage = userMessages[userMessages.length - 1].content.trim();
  if (!userMessage) {
    yield { type: "error", content: "Empty message." };
    return;
  }

  const prior = messages.slice(0, -1);
  const toolName = mcp.resolveTool();
  const args = buildChatArgs(toolName, userMessage, prior);

  yield { type: "status", content: "Asking Glean..." };
  yield { type: "tool_call", name: toolName, arguments: args };

  let toolResult;
  try {
    toolResult = await mcp.callTool(toolName, args);
  } catch (err) {
    yield { type: "error", content: `MCP tool failed: ${err}` };
    return;
  }

  yield {
    type: "tool_result",
    name: toolName,
    content: toolResult.text,
    raw: toolResult.raw,
  };

  const [answer, citations] = parseResponse(toolResult.text);
  yield { type: "text", content: answer, citations };
}
