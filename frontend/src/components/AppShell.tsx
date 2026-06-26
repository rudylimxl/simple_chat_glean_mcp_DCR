import Dashboard from "./Dashboard";
import Chat from "./Chat";
import "./AppShell.css";

interface AppShellProps {
  onHome: () => void;
}

export default function AppShell({ onHome }: AppShellProps) {
  return (
    <div className="app-shell">
      <main className="dashboard-panel">
        <Dashboard />
      </main>
      <aside className="chat-panel">
        <Chat onHome={onHome} />
      </aside>
    </div>
  );
}
