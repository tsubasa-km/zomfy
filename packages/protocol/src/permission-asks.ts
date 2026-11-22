// A permission ask (an approval, an AskUserQuestion) goes to every connected client at once —
// windows, paired phones, and later a bot's source — and the first answer wins. The others hear
// that it was answered and close their card. Shared by the phone app and Zomfy Bots.

/** `_meta` keys on a `session/request_permission` request. */
export const PERMISSION_ASK_META = {
  /** The ask's id, the same on every client it went to; `resolved` names it. */
  askId: 'harness/askId'
} as const

export const PERMISSION_ASK_NOTIFICATIONS = {
  /** An ask was answered (or withdrawn); every client closes its card for it. */
  resolved: '_harness/permissions/resolved'
} as const

export interface PermissionAskResolved {
  sessionId: string
  askId: string
  /** The option the winning answer picked; null when the ask was cancelled or withdrawn. */
  optionId: string | null
  /** The AskUserQuestion answers that came with it, so other cards can show them. */
  answers?: Record<string, string>
}
