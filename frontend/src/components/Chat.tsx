import { useCallback, useEffect, useRef, useState } from "react";
import AssistantMessage, { extractCitations, type Citation } from "./AssistantMessage";
import BrandIcon from "./BrandIcon";
import ToolBlock from "./ToolBlock";
import "./Chat.css";

interface Message {
  role: "user" | "assistant" | "tool";
  content: string;
  toolLabel?: string;
  citations?: Citation[];
}

interface Health {
  status: string;
  mcp_configured: boolean;
  glean_mcp_url: string | null;
  authenticated: boolean;
  auth_mode: "oauth" | "token";
  mcp: {
    connected: boolean;
    primary_tool: string | null;
  };
}

interface ChatProps {
  onHome: () => void;
}

export default function Chat({ onHome }: ChatProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [statusText, setStatusText] = useState<string | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const lastRawTextRef = useRef("");

  const fetchOpts: RequestInit = { credentials: "include" };

  const loadHealth = useCallback(() => {
    fetch("/api/health", fetchOpts)
      .then((r) => r.json())
      .then(setHealth)
      .catch(() => setHealth(null));
  }, []);

  useEffect(() => {
    loadHealth();
    const params = new URLSearchParams(window.location.search);
    if (params.has("auth_error")) {
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, [loadHealth]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, statusText]);

  const ready = health?.mcp_configured && health?.authenticated && health?.mcp.connected;

  const signIn = () => {
    window.location.href = "/api/auth/login";
  };

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || loading || !ready) return;

    const userMsg: Message = { role: "user", content: text };
    const chatHistory = messages.filter((m) => m.role === "user" || m.role === "assistant");
    const history = [...chatHistory, userMsg];
    setMessages(history);
    setInput("");
    setLoading(true);
    setStatusText("Thinking...");

    const assistantIdx = history.length;
    setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          messages: history.map((m) => ({ role: m.role, content: m.content })),
        }),
      });

      if (res.status === 401) {
        loadHealth();
        throw new Error("Session expired — please sign in again.");
      }

      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: res.statusText }));
        throw new Error(err.detail || "Request failed");
      }

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      if (!reader) throw new Error("No response stream");

      let buffer = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const payload = JSON.parse(line.slice(6));

          if (payload.type === "status") {
            setStatusText(payload.content);
          } else if (payload.type === "tool_call") {
            setMessages((prev) => [
              ...prev,
              {
                role: "tool",
                toolLabel: `MCP Request → ${payload.name}`,
                content: JSON.stringify(payload.arguments, null, 2),
              },
            ]);
          } else if (payload.type === "tool_result") {
            const rawText =
              payload.raw?.content?.[0]?.text ??
              (typeof payload.content === "string" ? payload.content : "");
            if (rawText) {
              lastRawTextRef.current = rawText;
            }
            setMessages((prev) => [
              ...prev,
              {
                role: "tool",
                toolLabel: `MCP Response ← ${payload.name}`,
                content: JSON.stringify(payload.raw ?? payload.content, null, 2),
              },
            ]);
          } else if (payload.type === "text") {
            setStatusText(null);
            setMessages((prev) => {
              const next = [...prev];
              next[assistantIdx] = {
                role: "assistant",
                content: payload.content,
                citations:
                  payload.citations?.length > 0
                    ? payload.citations
                    : extractCitations(lastRawTextRef.current),
              };
              return next;
            });
          } else if (payload.type === "error") {
            setStatusText(null);
            setMessages((prev) => {
              const next = [...prev];
              next[assistantIdx] = {
                role: "assistant",
                content: `Sorry, something went wrong: ${payload.content}`,
              };
              return next;
            });
          }
        }
      }
    } catch (err) {
      setStatusText(null);
      setMessages((prev) => {
        const next = [...prev];
        next[assistantIdx] = {
          role: "assistant",
          content: `Error: ${err instanceof Error ? err.message : String(err)}`,
        };
        return next;
      });
    } finally {
      setLoading(false);
      setStatusText(null);
    }
  }, [input, loading, messages, ready, loadHealth]);

  if (health && !health.mcp_configured) {
    return (
      <div className="chat-app chat-gate">
        <div className="login-card">
          <BrandIcon size="large" />
          <h1>Assistant</h1>
          <p>Set your Glean MCP URL before chatting.</p>
          <button type="button" className="login-btn" onClick={onHome}>
            Go to home
          </button>
        </div>
      </div>
    );
  }

  if (health && !health.authenticated && health.auth_mode === "oauth") {
    return (
      <div className="chat-app chat-gate">
        <div className="login-card">
          <BrandIcon size="large" />
          <h1>Assistant</h1>
          <p>Sign in with your company account to search your organization&apos;s knowledge base.</p>
          <button type="button" className="login-btn" onClick={signIn}>
            Sign in
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="chat-app">
      <header className="chat-header">
        <div className="brand">
          <BrandIcon />
          <div>
            <h1>Assistant</h1>
            <p className="subtitle">Ask me anything about your company</p>
          </div>
        </div>
        <div className="header-actions">
          <button type="button" className="home-btn" onClick={onHome}>
            Home
          </button>
          {health && !ready && (
            <span className="offline-badge">Connecting...</span>
          )}
        </div>
      </header>

      <div className="messages">
        {messages.length === 0 && (
          <div className="empty-state">
            <h2>How can I help?</h2>
            <p>
              Ask a question and I&apos;ll look up the answer from your
              organization&apos;s knowledge base.
            </p>
            <div className="suggestions">
              {[
                "What are our company holidays?",
                "How do I request time off?",
                "Summarize our remote work policy",
              ].map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setInput(s)}
                  disabled={loading || !ready}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} className={`bubble-row bubble-${m.role}`}>
            {m.role === "assistant" && (
              <div className="avatar">A</div>
            )}
            {m.role === "tool" ? (
              <ToolBlock label={m.toolLabel ?? "MCP"} content={m.content} />
            ) : m.role === "assistant" ? (
              <AssistantMessage
                content={m.content}
                citations={m.citations}
                loading={loading && i === messages.length - 1}
              />
            ) : (
              <div className={`bubble bubble-${m.role}`}>{m.content}</div>
            )}
          </div>
        ))}

        {statusText && (
          <div className="status-line">
            <span className="pulse" />
            {statusText}
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      <footer className="composer">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          placeholder={ready ? "Message Assistant..." : "Sign in to start chatting..."}
          rows={1}
          disabled={loading || !ready}
        />
        <button
          type="button"
          onClick={send}
          disabled={loading || !input.trim() || !ready}
          aria-label="Send"
        >
          ↑
        </button>
      </footer>
    </div>
  );
}
