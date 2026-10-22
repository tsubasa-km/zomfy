/** What a chat attachment was taken from; the composer shows it as a mention chip. */
export type ChatAttachmentKind = 'terminal' | 'chat'

export interface SaveChatAttachmentParams {
  /** The chat whose message will carry the attachment; the file lives on that chat's host. */
  sessionId: string
  kind: ChatAttachmentKind
  /** The terminal or chat it was taken from, so its mention can lead back there. */
  sourceId: string
  /** Shown on the chip (a command, a chat title). */
  title: string
  /** The terminal's screen or the chat's transcript, as plain text. */
  text: string
}

export const CHAT_ATTACHMENT_METHODS = {
  chatAttachmentSave: '_harness/chatAttachments/save'
} as const

export interface ChatAttachmentRequests {
  /**
   * Saves a snapshot for a message to mention; returns its path on the daemon host. The agent
   * reads it on demand instead of the text riding in the prompt.
   */
  [CHAT_ATTACHMENT_METHODS.chatAttachmentSave]: { params: SaveChatAttachmentParams; result: { path: string } }
}
