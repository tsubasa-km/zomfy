import { useSyncExternalStore } from "react";
import type * as acp from "@agentclientprotocol/sdk";

export type ThreadItem =
  | { kind: "user"; text: string }
  | { kind: "agent"; text: string }
  | { kind: "thought"; text: string }
  | { kind: "notice"; text: string }
  | { kind: "tool"; id: string; title: string; status: string; output: string }
  | {
      kind: "permission";
      requestId: string;
      title: string;
      options: acp.PermissionOption[];
      chosen: string | null;
    };

export type SessionStatus = "idle" | "working" | "needs-you" | "error";

export interface Session {
  id: string;
  cwd: string;
  title: string;
  status: SessionStatus;
  items: ThreadItem[];
}

export type ConnectionState =
  | { kind: "connecting" }
  | { kind: "connected"; url: string }
  | { kind: "offline"; reason: string };

interface StoreState {
  connection: ConnectionState;
  sessions: Session[];
  activeSessionId: string | null;
}

let state: StoreState = {
  connection: { kind: "connecting" },
  sessions: [],
  activeSessionId: null,
};
const listeners = new Set<() => void>();

function set(next: StoreState): void {
  state = next;
  for (const listener of listeners) listener();
}

export function useStore<T>(select: (s: StoreState) => T): T {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => select(state),
  );
}

export function getState(): StoreState {
  return state;
}

export function setConnection(connection: ConnectionState): void {
  set({ ...state, connection });
}

export function addSession(session: Session): void {
  set({ ...state, sessions: [...state.sessions, session], activeSessionId: session.id });
}

export function selectSession(id: string): void {
  set({ ...state, activeSessionId: id });
}

export function updateSession(id: string, change: (s: Session) => Session): void {
  set({ ...state, sessions: state.sessions.map((s) => (s.id === id ? change(s) : s)) });
}

/** Streams arrive as many small chunks; merge them into the trailing item of the same kind. */
export function appendText(id: string, kind: "agent" | "thought", text: string): void {
  updateSession(id, (s) => {
    const last = s.items.at(-1);
    if (last?.kind === kind) {
      return { ...s, items: [...s.items.slice(0, -1), { kind, text: last.text + text }] };
    }
    return { ...s, items: [...s.items, { kind, text }] };
  });
}

export function upsertTool(
  id: string,
  toolId: string,
  patch: Partial<Extract<ThreadItem, { kind: "tool" }>>,
): void {
  updateSession(id, (s) => {
    const index = s.items.findIndex((item) => item.kind === "tool" && item.id === toolId);
    if (index === -1) {
      const item: ThreadItem = { kind: "tool", id: toolId, title: "Tool", status: "pending", output: "", ...patch };
      return { ...s, items: [...s.items, item] };
    }
    const items = s.items.slice();
    const current = items[index];
    if (current?.kind === "tool") items[index] = { ...current, ...patch };
    return { ...s, items };
  });
}
