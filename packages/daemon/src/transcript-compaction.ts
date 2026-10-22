import type * as acp from "@agentclientprotocol/sdk";

type TextChunk = Extract<
  acp.SessionUpdate,
  { sessionUpdate: "agent_message_chunk" | "agent_thought_chunk" | "user_message_chunk" }
>;

function textChunk(update: acp.SessionUpdate): TextChunk | null {
  if (
    update.sessionUpdate !== "agent_message_chunk" &&
    update.sessionUpdate !== "agent_thought_chunk" &&
    update.sessionUpdate !== "user_message_chunk"
  ) {
    return null;
  }
  return update.content.type === "text" ? update : null;
}

/**
 * Joins runs of streamed text chunks of one kind and message into single updates, so a replay
 * sends a few dozen notifications instead of one per streamed token batch. Clients append chunk
 * text, so the joined transcript renders the same.
 */
export function compactTranscript(updates: acp.SessionUpdate[]): acp.SessionUpdate[] {
  const out: acp.SessionUpdate[] = [];
  for (const update of updates) {
    const chunk = textChunk(update);
    const previous = out.at(-1);
    const last = previous ? textChunk(previous) : null;
    if (
      chunk &&
      last &&
      last.sessionUpdate === chunk.sessionUpdate &&
      (last.messageId ?? null) === (chunk.messageId ?? null) &&
      JSON.stringify(last._meta ?? null) === JSON.stringify(chunk._meta ?? null) &&
      last.content.type === "text" &&
      chunk.content.type === "text"
    ) {
      out[out.length - 1] = { ...last, content: { ...last.content, text: last.content.text + chunk.content.text } };
      continue;
    }
    out.push(update);
  }
  return out;
}
