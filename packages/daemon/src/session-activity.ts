import type { SessionRegistry } from "./session-registry.ts";

// Lines a session's next turn starts with, unseen in its transcript: a project Lead hears what
// happened in the project (the person's prompts elsewhere, sessions ending, workflow runs).

const ACTIVITY_HEADER = "[Project activity since your last turn]";

export function noteActivity(sessions: SessionRegistry, sessionId: string, text: string): void {
  const session = sessions.get(sessionId);
  if (!session) throw new Error(`Unknown session ${sessionId}`);
  const line = `- ${text.replace(/\s+/g, " ").slice(0, 2000)}`;
  // Kept bounded: a lead away for a long time gets the latest activity, not an unbounded log.
  const lines = [...(session.seedContext?.split("\n").filter((l) => l.startsWith("- ")) ?? []), line].slice(-40);
  sessions.update(session.id, { seedContext: [ACTIVITY_HEADER, ...lines].join("\n") });
}
