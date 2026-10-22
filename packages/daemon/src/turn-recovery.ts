import type * as acp from "@agentclientprotocol/sdk";

// What a recovery turn (Continue, Retry, Resume, the scheduled resume) sends: the last prompt again
// when nothing answered it, else a request to pick up where the reply stopped.

export const CONTINUE_PROMPT =
  "Your previous reply was cut off before it finished. First check whether the step you were in the middle of completed, then continue from where you stopped.";

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
  const answered = transcript.slice(last + 1).some((u) => REPLY_UPDATES.has(u.sessionUpdate));
  if (answered) return [{ type: "text", text: CONTINUE_PROMPT }];
  // Nothing came back (the request itself failed): the same prompt, every block of it.
  const id = lastPrompt.messageId;
  if (!id) return [lastPrompt.content];
  return transcript.filter((u): u is UserChunk => isPrompt(u) && u.messageId === id).map((u) => u.content);
}
