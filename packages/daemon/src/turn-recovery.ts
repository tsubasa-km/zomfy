import type * as acp from "@agentclientprotocol/sdk";

// What a recovery turn (Continue, Retry, Resume, the scheduled resume) sends: the last prompt again
// when nothing answered it, else a request to pick up where the reply stopped.

export const CONTINUE_PROMPT =
  "Your previous reply was interrupted, so I may not have seen all of it. First check whether the step you were in the middle of completed, then continue from where you stopped.";

/** Claude may have finished a reply the stop cut off on screen; the seen tail tells it where to resume. */
const SEEN_TAIL_CHARS = 300;

type UserChunk = Extract<acp.SessionUpdate, { sessionUpdate: "user_message_chunk" }>;

const REPLY_UPDATES = new Set<acp.SessionUpdate["sessionUpdate"]>([
  "agent_message_chunk",
  "agent_thought_chunk",
  "tool_call",
]);

export function recoveryPrompt(transcript: readonly acp.SessionUpdate[]): acp.ContentBlock[] {
  const isPrompt = (u: acp.SessionUpdate): u is UserChunk => u.sessionUpdate === "user_message_chunk";
  let last = -1;
  for (let i = transcript.length - 1; i >= 0; i--) {
    const update = transcript[i];
    if (update && isPrompt(update)) {
      last = i;
      break;
    }
  }
  const lastPrompt = transcript[last];
  if (!lastPrompt || !isPrompt(lastPrompt)) throw new Error("There is no message to pick up from yet");
  const after = transcript.slice(last + 1);
  if (after.some((u) => REPLY_UPDATES.has(u.sessionUpdate))) {
    const seen = after
      .flatMap((u) => (u.sessionUpdate === "agent_message_chunk" && u.content.type === "text" ? [u.content.text] : []))
      .join("")
      .trimEnd();
    const tail = seen.length > SEEN_TAIL_CHARS ? `…${seen.slice(-SEEN_TAIL_CHARS)}` : seen;
    const text = tail ? `${CONTINUE_PROMPT}\n\nThe last part of your reply that reached me:\n"""\n${tail}\n"""` : CONTINUE_PROMPT;
    return [{ type: "text", text }];
  }
  // Nothing came back (the request itself failed): the same prompt, every block of it.
  const id = lastPrompt.messageId;
  if (!id) return [lastPrompt.content];
  return transcript.filter((u): u is UserChunk => isPrompt(u) && u.messageId === id).map((u) => u.content);
}
