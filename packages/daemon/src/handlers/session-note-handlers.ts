import { HARNESS_METHODS } from "@acp-harness/protocol";
import type { HandlerContext } from "./handler-context.ts";

/** A memo in UTF-16 units; generous for notes, small enough to keep a runaway paste off disk. */
const MAX_NOTE_LENGTH = 1_000_000;

/** Chat memos, stored beside the session's transcript and removed with it. */
export function registerSessionNoteHandlers({ handle, sessions }: HandlerContext): void {
  // Only known sessions: their ids name the file, so an unknown id never reaches the filesystem.
  const known = (sessionId: string) => {
    if (!sessions.get(sessionId)) throw new Error(`Unknown session ${sessionId}`);
    return sessionId;
  };
  handle(HARNESS_METHODS.sessionNoteRead, async (p) => ({ text: await sessions.readNote(known(p.sessionId)) }));
  handle(HARNESS_METHODS.sessionNoteWrite, async (p) => {
    if (typeof p.text !== "string" || p.text.length > MAX_NOTE_LENGTH) throw new Error("Memo is too long");
    await sessions.writeNote(known(p.sessionId), p.text);
    return {};
  });
}
