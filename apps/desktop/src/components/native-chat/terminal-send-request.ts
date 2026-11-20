import { getState } from '@/session-store'
import type { RequestFacts } from './split-plan'
import { t } from '@/i18n/i18n'

// A terminal_send request, as the person should see it before approving: which terminal (and
// whether it is a production server), and exactly what will be typed into it.

const KEY_NAMES: Record<string, string> = {
  'ctrl-c': 'Ctrl+C',
  'ctrl-d': 'Ctrl+D',
  escape: 'Esc',
  tab: 'Tab',
  up: '↑',
  down: '↓',
  enter: 'Enter'
}

function inputOf(request: RequestFacts): Record<string, unknown> | null {
  if (!request.toolName?.endsWith('__terminal_send')) return null
  return typeof request.input === 'object' && request.input !== null ? (request.input as Record<string, unknown>) : null
}

/** The card's title for a terminal_send request, or null for any other request. */
export function terminalSendTitle(request: RequestFacts): string | null {
  const input = inputOf(request)
  if (!input) return null
  const terminal = getState().terminals.find((term) => term.id === input.terminalId)
  const name = terminal?.title ?? t('a terminal')
  return terminal?.connection?.tag === 'production'
    ? t('Type into "{name}", a production server?', { name })
    : t('Type into "{name}"?', { name })
}

/** What will be typed, as Markdown, or null for any other request. */
export function terminalSendDetails(request: RequestFacts): string | null {
  const input = inputOf(request)
  if (!input) return null
  if (typeof input.key === 'string') return t('Presses {key}.', { key: `**${KEY_NAMES[input.key] ?? input.key}**` })
  const text = typeof input.text === 'string' ? input.text : ''
  const fence = text.includes('```') ? '~~~' : '```'
  return [`${fence}text`, text, fence, input.enter === false ? t('Without pressing Enter.') : t('Then presses Enter.')].join('\n')
}
