import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { connectLocalDaemon, createSession } from "../daemon-connection";
import { selectSession, useStore, type Session } from "../session-store";

const STATUS_LABEL: Record<Session["status"], string> = {
  idle: "Idle",
  working: "Working",
  "needs-you": "Needs you",
  error: "Error",
};

export function Sidebar() {
  const connection = useStore((s) => s.connection);
  const sessions = useStore((s) => s.sessions);
  const activeId = useStore((s) => s.activeSessionId);
  const waiting = sessions.filter((s) => s.status === "needs-you");

  return (
    <aside className="sidebar">
      <header className="sidebar-header">
        <span className="brand">ACP Harness</span>
      </header>

      {waiting.length > 0 && (
        <section className="sidebar-section">
          <h2 className="section-title">Waiting for you</h2>
          {waiting.map((s) => (
            <button key={s.id} className="row row-attention" onClick={() => selectSession(s.id)}>
              <span className="status-dot status-needs-you" />
              <span className="row-title">{s.title}</span>
            </button>
          ))}
        </section>
      )}

      <section className="sidebar-section grow">
        <h2 className="section-title">
          <span className={`status-dot conn-${connection.kind}`} />
          Local
        </h2>
        {connection.kind === "offline" && (
          <div className="offline">
            <p>{connection.reason}</p>
            <p className="hint">Run <code>bun run daemon</code>, then retry.</p>
            <button className="button" onClick={() => void connectLocalDaemon()}>
              Retry
            </button>
          </div>
        )}
        {sessions.map((s) => (
          <button
            key={s.id}
            className={`row ${s.id === activeId ? "row-active" : ""}`}
            onClick={() => selectSession(s.id)}
            title={s.cwd}
          >
            <span className={`status-dot status-${s.status}`} />
            <span className="row-title">{s.title}</span>
            <span className="row-meta">{STATUS_LABEL[s.status]}</span>
          </button>
        ))}
        {connection.kind === "connected" && <NewSessionButton />}
      </section>
    </aside>
  );
}

function NewSessionButton() {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function pickFolder() {
    setError(null);
    const folder = await open({ directory: true, title: "Choose a folder for the new session" });
    if (typeof folder !== "string") return;
    setBusy(true);
    try {
      await createSession(folder);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="new-session">
      <button className="button" onClick={() => void pickFolder()} disabled={busy}>
        {busy ? "Starting…" : "+ New session"}
      </button>
      {error && <p className="error">{error}</p>}
    </div>
  );
}
