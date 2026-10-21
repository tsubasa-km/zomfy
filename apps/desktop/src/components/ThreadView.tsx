import { useEffect, useRef, useState } from "react";
import { answerPermission, cancelTurn, sendPrompt } from "../daemon-connection";
import type { Session, ThreadItem } from "../session-store";

export function ThreadView({ session }: { session: Session }) {
  const bottom = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Braces matter: newer WebView2 returns a Promise here, which React would treat as cleanup.
    void bottom.current?.scrollIntoView({ block: "end" });
  }, [session.items]);

  return (
    <div className="thread">
      <header className="thread-header">
        <span className="thread-title">{session.title}</span>
        <span className="thread-cwd">{session.cwd}</span>
      </header>
      <div className="thread-body">
        {session.items.map((item, index) => (
          <ThreadRow key={index} item={item} />
        ))}
        <div ref={bottom} />
      </div>
      <Composer session={session} />
    </div>
  );
}

function ThreadRow({ item }: { item: ThreadItem }) {
  switch (item.kind) {
    case "user":
      return <div className="msg msg-user">{item.text}</div>;
    case "agent":
      return <div className="msg msg-agent">{item.text}</div>;
    case "notice":
      return <div className="notice">{item.text}</div>;
    case "thought":
      return (
        <details className="msg msg-thought">
          <summary>Thinking</summary>
          {item.text}
        </details>
      );
    case "tool":
      return (
        <details className="tool">
          <summary>
            <span className={`tool-status tool-${item.status}`}>{item.status}</span>
            <span className="tool-title">{item.title}</span>
          </summary>
          {item.output && <pre className="tool-output">{item.output}</pre>}
        </details>
      );
    case "permission":
      return (
        <div className="permission">
          <div className="permission-title">Allow: {item.title}</div>
          {item.chosen ? (
            <div className="permission-chosen">→ {item.chosen}</div>
          ) : (
            <div className="permission-actions">
              {item.options.map((option) => (
                <button
                  key={option.optionId}
                  className={`button ${option.kind.startsWith("allow") ? "button-primary" : ""}`}
                  onClick={() => answerPermission(item.requestId, option.optionId)}
                >
                  {option.name}
                </button>
              ))}
            </div>
          )}
        </div>
      );
  }
}

function Composer({ session }: { session: Session }) {
  const [text, setText] = useState("");
  const busy = session.status === "working" || session.status === "needs-you";

  function submit() {
    const value = text.trim();
    if (!value || busy) return;
    setText("");
    void sendPrompt(session.id, value);
  }

  return (
    <div className="composer">
      <textarea
        className="composer-input"
        placeholder="Message the agent (Enter to send, Shift+Enter for newline)"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            submit();
          }
        }}
      />
      {busy ? (
        <button className="button" onClick={() => cancelTurn(session.id)}>
          Stop
        </button>
      ) : (
        <button className="button button-primary" onClick={submit}>
          Send
        </button>
      )}
    </div>
  );
}
