import { t } from '@/i18n/i18n'
// Claude Code records a finished background command as a user message wrapped in <task-notification>;
// those are the CLI's words, not the person's, so they render as a status line instead of a bubble.

export type TaskNotification = { status: string | null; summary: string }

const BLOCK = /<task-notification>([\s\S]*?)<\/task-notification>/g

function tag(body: string, name: string): string | null {
  const match = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(body)
  return match?.[1]?.trim() || null
}

/** The notifications in a user message, and whatever the person wrote around them. */
export function splitTaskNotifications(text: string): { notifications: TaskNotification[]; rest: string } {
  const notifications: TaskNotification[] = []
  const rest = text.replace(BLOCK, (_, body: string) => {
    notifications.push({ status: tag(body, 'status'), summary: tag(body, 'summary') ?? t('Background task finished') })
    return ''
  })
  return { notifications, rest: notifications.length > 0 ? rest.trim() : text }
}
