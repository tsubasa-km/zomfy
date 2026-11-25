import type * as acp from "@agentclientprotocol/sdk";

// What the wrap_up tool answers. The card is drawn from the call's input whatever the result says;
// the result only steers what the agent does next. A model that wrote its answer inside its
// thinking (which the person never sees) is told so here, while it can still write it out.

export const WRAP_UP_DONE =
  "Shown to the person as a Next steps card under your reply. End the turn now without repeating your answer (one short line at most).";

export const WRAP_UP_NO_ANSWER =
  "Shown to the person as a Next steps card. But you have not written any reply text in this turn, and your thinking is never shown to the person: write your complete answer now as your visible reply, then end the turn.";

/** Whether the turn so far (since its prompt) has visible reply text, not only thinking and tool calls. */
export function repliedThisTurn(transcript: readonly acp.SessionUpdate[]): boolean {
  for (let i = transcript.length - 1; i >= 0; i--) {
    const update = transcript[i]!;
    if (update.sessionUpdate === "user_message_chunk") return false;
    if (update.sessionUpdate === "agent_message_chunk" && update.content.type === "text" && update.content.text.trim()) return true;
  }
  return false;
}
