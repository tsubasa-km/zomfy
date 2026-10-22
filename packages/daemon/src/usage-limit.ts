// Telling a Claude usage/rate-limit failure from other turn errors, and when the limit resets.
// The Agent SDK reports it three ways: a `rate_limit_event` whose status is `rejected` (with
// `resetsAt` in epoch seconds), an assistant message with `error: "rate_limit"`, and the result's
// text, which the CLI words as "Claude AI usage limit reached|<epoch>" or "… limit reached ∙ resets 3pm".

export interface UsageLimitSignals {
  /** The failed result's or thrown error's text. */
  text?: string | null
  /** SDKAssistantMessage.error seen during the turn. */
  assistantError?: string | null
  /** The latest rate_limit_event's info, when it said `rejected`. */
  rejected?: { resetsAt?: number } | null
}

const LIMIT_TEXT_RE = /usage limit|rate[ _-]?limit|hit your (?:usage )?limit|limit reached|limit will reset|out of (?:extra )?usage/i

/** The limit's reset (epoch ms, or null when unknown), or undefined when this is not a usage limit. */
export function detectUsageLimit(signals: UsageLimitSignals, now = Date.now()): { resetsAt: number | null } | undefined {
  const text = signals.text ?? ''
  const limited = signals.rejected != null || signals.assistantError === 'rate_limit' || LIMIT_TEXT_RE.test(text)
  if (!limited) return undefined
  const fromEvent = signals.rejected?.resetsAt
  const resetsAt = fromEvent ? epochMs(fromEvent) : parseResetTime(text, now)
  // A reset already behind us is stale (an older event); treat it as unknown.
  return { resetsAt: resetsAt !== null && resetsAt > now - 60_000 ? resetsAt : null }
}

function epochMs(value: number): number {
  return value < 1e12 ? value * 1000 : value
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

/**
 * "…|1717171717", "resets 3pm", "resets 3:30 pm (Asia/Tokyo)", "reset at 15:00", "resets Oct 9, 3pm".
 * Clock times are the CLI's local time, which is this host's: the CLI runs here.
 */
export function parseResetTime(text: string, now = Date.now()): number | null {
  const epoch = /\|\s*(\d{10,13})\b/.exec(text)
  if (epoch) return epochMs(Number(epoch[1]))
  const match =
    /resets?\s+(?:at\s+)?(?:([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(?:at\s+)?)?(\d{1,2})(?::(\d{2}))?\s*([ap]\.?m\.?)?/i.exec(text)
  if (!match) return null
  const [, monthName, day, hourText, minuteText, meridiem] = match
  let hour = Number(hourText)
  const minute = minuteText ? Number(minuteText) : 0
  // A bare number with no am/pm or minutes ("resets 5 hours") is not a clock time.
  if (!meridiem && !minuteText) return null
  if (meridiem) {
    const pm = meridiem.toLowerCase().startsWith('p')
    if (hour === 12) hour = pm ? 12 : 0
    else if (pm) hour += 12
  }
  if (hour > 23 || minute > 59) return null
  const at = new Date(now)
  at.setSeconds(0, 0)
  at.setHours(hour, minute)
  const month = monthName ? MONTHS.indexOf(monthName.toLowerCase()) : -1
  if (month !== -1 && day) {
    at.setMonth(month, Number(day))
    if (at.getTime() < now - 60_000) at.setFullYear(at.getFullYear() + 1)
  } else if (at.getTime() <= now) {
    at.setDate(at.getDate() + 1)
  }
  return at.getTime()
}
