// Chat memos (experimental): a markdown note per chat session, kept by the host that owns the
// session, so a WSL or SSH chat's memo lives beside its transcript.

export const SESSION_NOTE_METHODS = {
  sessionNoteRead: '_harness/sessions/note/read',
  sessionNoteWrite: '_harness/sessions/note/write'
} as const

export interface SessionNoteRequests {
  /** Empty text when the chat has no memo yet. */
  [SESSION_NOTE_METHODS.sessionNoteRead]: { params: { sessionId: string }; result: { text: string } }
  /** Empty text removes the memo. */
  [SESSION_NOTE_METHODS.sessionNoteWrite]: { params: { sessionId: string; text: string }; result: Record<string, never> }
}
