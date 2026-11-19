// "Continue in Terminal": which chats' conversations a `claude` terminal runs now. While one does,
// the chat starts no turn of its own, or two writers would split the conversation.

/** Reserved while the terminal is being opened, so nothing slips in before it exists. */
const OPENING = "";

export class CliConversations {
  private readonly terminals = new Map<string, string>();

  /** `exited(id)` is true once that terminal has exited or been closed. */
  constructor(private readonly exited: (terminalId: string) => boolean) {}

  /** Takes the conversation for a terminal about to open; false when one already has it. */
  reserve(sessionId: string): boolean {
    if (this.has(sessionId)) return false;
    this.terminals.set(sessionId, OPENING);
    return true;
  }

  /** The terminal is open (or, with null, did not open after all). */
  settle(sessionId: string, terminalId: string | null): void {
    if (terminalId) this.terminals.set(sessionId, terminalId);
    else this.terminals.delete(sessionId);
  }

  has(sessionId: string): boolean {
    const terminalId = this.terminals.get(sessionId);
    if (terminalId === undefined) return false;
    if (terminalId === OPENING || !this.exited(terminalId)) return true;
    // Exited or closed: the conversation is the chat's again.
    this.terminals.delete(sessionId);
    return false;
  }

  forget(sessionId: string): void {
    this.terminals.delete(sessionId);
  }
}
