import { useEffect, useState } from "react";
import AppShell from "./components/AppShell";
import Home from "./components/Home";

type View = "home" | "chat";

const fetchOpts: RequestInit = { credentials: "include" };

export default function App() {
  const [view, setView] = useState<View>("home");
  const [mcpUrl, setMcpUrl] = useState("");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    fetch("/api/config", fetchOpts)
      .then((r) => r.json())
      .then((data) => {
        if (data.glean_mcp_url) {
          setMcpUrl(data.glean_mcp_url);
          setView("chat");
        }
      })
      .finally(() => setReady(true));
  }, []);

  if (!ready) {
    return null;
  }

  if (view === "home") {
    return (
      <Home
        initialUrl={mcpUrl}
        onUrlSaved={setMcpUrl}
        onContinue={() => setView("chat")}
      />
    );
  }

  return <AppShell onHome={() => setView("home")} />;
}
