import { useState } from "react";
import BrandIcon from "./BrandIcon";
import "./Home.css";

interface HomeProps {
  initialUrl: string;
  onContinue: () => void;
  onUrlSaved: (url: string) => void;
}

const fetchOpts: RequestInit = { credentials: "include" };

export default function Home({ initialUrl, onContinue, onUrlSaved }: HomeProps) {
  const [url, setUrl] = useState(initialUrl);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    const trimmed = url.trim();
    if (!trimmed) {
      setError("Enter your Glean MCP URL");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        ...fetchOpts,
        body: JSON.stringify({ glean_mcp_url: trimmed }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: res.statusText }));
        throw new Error(err.detail || "Failed to save URL");
      }
      const data = await res.json();
      onUrlSaved(data.glean_mcp_url);
      onContinue();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="home-app">
      <div className="home-card">
        <BrandIcon size="large" />
        <h1>Assistant</h1>
        <p className="home-subtitle">
          Connect to your Glean MCP server to start chatting.
        </p>

        <label className="home-label" htmlFor="mcp-url">
          Glean MCP URL
        </label>
        <input
          id="mcp-url"
          className="home-input"
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://your-tenant-be.glean.com/mcp/default"
          onKeyDown={(e) => {
            if (e.key === "Enter") save();
          }}
        />
        <p className="home-hint">
          From Glean Admin → Platform → Glean MCP server
        </p>

        {error && <p className="home-error">{error}</p>}

        <button
          type="button"
          className="home-btn"
          onClick={save}
          disabled={saving || !url.trim()}
        >
          {saving ? "Saving..." : "Continue to chat"}
        </button>
      </div>
    </div>
  );
}
