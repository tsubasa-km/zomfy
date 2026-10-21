import { useEffect } from "react";
import { connectLocalDaemon } from "./daemon-connection";
import { useStore } from "./session-store";
import { Sidebar } from "./components/Sidebar";
import { ThreadView } from "./components/ThreadView";
import "./styles.css";

export default function App() {
  const activeSession = useStore((s) => s.sessions.find((x) => x.id === s.activeSessionId) ?? null);

  useEffect(() => {
    void connectLocalDaemon();
  }, []);

  return (
    <div className="app">
      <Sidebar />
      <main className="main">
        {activeSession ? (
          <ThreadView session={activeSession} />
        ) : (
          <div className="empty">Create a session from the sidebar to start.</div>
        )}
      </main>
    </div>
  );
}
