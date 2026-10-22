// The RRULE subset Orca's automations use (shared/automation-schedule-parsing.ts,
// automation-schedule-occurrences.ts): hourly, daily, weekdays and weekly presets, in the
// scheduling host's local time. Orca's custom cron is not carried over.

export type AutomationSchedulePreset = 'hourly' | 'daily' | 'weekdays' | 'weekly'

export interface ParsedAutomationRrule {
  freq: 'HOURLY' | 'DAILY' | 'WEEKLY'
  byDay: string[]
  byHour: number
  byMinute: number
}

/** The shape a schedule picker edits. */
export interface AutomationScheduleFields {
  preset: AutomationSchedulePreset
  hour: number
  minute: number
  /** 0 = Sunday; weekly only. */
  dayOfWeek: number
}

const DAY_MS = 24 * 60 * 60 * 1000
const HOUR_MS = 60 * 60 * 1000
const DAY_CODES = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'] as const
const WEEKDAYS = ['MO', 'TU', 'WE', 'TH', 'FR']
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const

export function parseAutomationRrule(rrule: string): ParsedAutomationRrule {
  const entries = new Map<string, string>()
  for (const part of rrule.trim().split(';')) {
    const [key, value] = part.split('=')
    if (key && value) entries.set(key.toUpperCase(), value.toUpperCase())
  }
  const freq = entries.get('FREQ')
  if (freq !== 'HOURLY' && freq !== 'DAILY' && freq !== 'WEEKLY') throw new Error('Unsupported automation recurrence.')
  const byHour = Number(entries.get('BYHOUR') ?? '9')
  const byMinute = Number(entries.get('BYMINUTE') ?? '0')
  if (!Number.isInteger(byHour) || byHour < 0 || byHour > 23) throw new Error('Invalid recurrence hour.')
  if (!Number.isInteger(byMinute) || byMinute < 0 || byMinute > 59) throw new Error('Invalid recurrence minute.')
  const byDay = (entries.get('BYDAY') ?? '').split(',').filter(Boolean)
  if (freq === 'WEEKLY' && (byDay.length === 0 || byDay.some((d) => !DAY_CODES.some((code) => code === d)))) {
    throw new Error('Invalid recurrence day.')
  }
  return { freq, byDay, byHour, byMinute }
}

export function buildAutomationRrule(fields: AutomationScheduleFields): string {
  const hour = clamp(fields.hour, 0, 23)
  const minute = clamp(fields.minute, 0, 59)
  if (fields.preset === 'hourly') return `FREQ=HOURLY;BYMINUTE=${minute}`
  if (fields.preset === 'weekdays') return `FREQ=WEEKLY;BYDAY=${WEEKDAYS.join(',')};BYHOUR=${hour};BYMINUTE=${minute}`
  if (fields.preset === 'weekly') {
    return `FREQ=WEEKLY;BYDAY=${DAY_CODES[clamp(fields.dayOfWeek, 0, 6)]};BYHOUR=${hour};BYMINUTE=${minute}`
  }
  return `FREQ=DAILY;BYHOUR=${hour};BYMINUTE=${minute}`
}

/** The picker's fields for a saved rule; null when the rule is not one the picker can show. */
export function automationScheduleFields(rrule: string): AutomationScheduleFields | null {
  try {
    const rule = parseAutomationRrule(rrule)
    const base = { hour: rule.byHour, minute: rule.byMinute, dayOfWeek: 1 }
    if (rule.freq === 'HOURLY') return { ...base, preset: 'hourly' }
    if (rule.freq === 'DAILY') return { ...base, preset: 'daily' }
    if (rule.byDay.length === WEEKDAYS.length && WEEKDAYS.every((d) => rule.byDay.includes(d))) {
      return { ...base, preset: 'weekdays' }
    }
    const [day] = rule.byDay
    if (rule.byDay.length === 1 && day) return { ...base, preset: 'weekly', dayOfWeek: DAY_CODES.findIndex((c) => c === day) }
    return null
  } catch {
    return null
  }
}

/** English label, as Orca's formatAutomationSchedule gives the CLI. */
export function describeAutomationSchedule(rrule: string): string {
  const fields = automationScheduleFields(rrule)
  if (!fields) return 'Custom schedule'
  const time = `${String(fields.hour).padStart(2, '0')}:${String(fields.minute).padStart(2, '0')}`
  if (fields.preset === 'hourly') return `Hourly at :${String(fields.minute).padStart(2, '0')}`
  if (fields.preset === 'daily') return `Daily at ${time}`
  if (fields.preset === 'weekdays') return `Weekdays at ${time}`
  return `${DAY_NAMES[fields.dayOfWeek]}s at ${time}`
}

/** The first occurrence strictly after `after`, in local time. */
export function nextAutomationOccurrenceAfter(rrule: string, after: number): number {
  const rule = parseAutomationRrule(rrule)
  if (rule.freq === 'HOURLY') {
    const base = new Date(after)
    base.setMinutes(rule.byMinute, 0, 0)
    const candidate = base.getTime()
    return candidate > after ? candidate : candidate + HOUR_MS
  }
  const day = new Date(after)
  day.setHours(0, 0, 0, 0)
  for (let i = 0; i < 9; i += 1) {
    const candidate = new Date(day.getTime() + i * DAY_MS + 2 * HOUR_MS)
    // Set from a mid-day anchor so a DST shift cannot land on the wrong date.
    candidate.setHours(rule.byHour, rule.byMinute, 0, 0)
    const time = candidate.getTime()
    if (time > after && (rule.freq === 'DAILY' || rule.byDay.includes(DAY_CODES[candidate.getDay()] ?? ''))) return time
  }
  throw new Error('Unable to compute next automation run.')
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.floor(value)))
}
