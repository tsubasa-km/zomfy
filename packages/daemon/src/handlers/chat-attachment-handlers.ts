import { HARNESS_METHODS } from "@acp-harness/protocol";
import { saveChatAttachment } from "../chat-attachment-files.ts";
import type { HandlerContext } from "./handler-context.ts";

/** A snapshot in UTF-16 units: a long scrollback or transcript, but never an unbounded paste. */
const MAX_ATTACHMENT_LENGTH = 5_000_000;

export function registerChatAttachmentHandlers({ handle, sessions }: HandlerContext): void {
  handle(HARNESS_METHODS.chatAttachmentSave, async (p) => {
    // The chat's id names the folder, so only a known chat reaches the filesystem.
    if (!sessions.get(p.sessionId)) throw new Error(`Unknown session ${p.sessionId}`);
    if (typeof p.text !== "string" || p.text.length > MAX_ATTACHMENT_LENGTH) throw new Error("Attachment is too long");
    return { path: await saveChatAttachment(p) };
  });
}
