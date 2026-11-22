import type { Bot } from '@zomfy/protocol'
import type { BotActivity } from '@/lib/bot-state'
import { cn } from '@/lib/utils'
import { t } from '@/i18n/i18n'

// A bot's picture: an image URL, a short text (an emoji), or its initial on a colour from its handle.

const COLOURS = ['bg-sky-600', 'bg-emerald-600', 'bg-violet-600', 'bg-amber-600', 'bg-rose-600', 'bg-teal-600']

function colourOf(handle: string): string {
  let hash = 0
  for (const char of handle) hash = (hash * 31 + char.charCodeAt(0)) | 0
  return COLOURS[Math.abs(hash) % COLOURS.length]!
}

export function BotAvatar({ bot, size = 20, className }: { bot: Pick<Bot, 'name' | 'handle' | 'avatar'>; size?: number; className?: string }) {
  const avatar = bot.avatar?.trim() ?? ''
  const style = { width: size, height: size, fontSize: Math.round(size * 0.55) }
  if (/^(https?:|data:image\/)/.test(avatar)) {
    return <img src={avatar} alt="" style={style} className={cn('shrink-0 rounded-full object-cover', className)} data-bot-avatar />
  }
  const text = avatar ? [...avatar].slice(0, 2).join('') : (bot.name.trim()[0] ?? bot.handle[0] ?? '?').toUpperCase()
  return (
    <span
      style={style}
      data-bot-avatar
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full leading-none font-semibold select-none',
        avatar ? 'bg-muted' : `${colourOf(bot.handle)} text-white`,
        className
      )}
      aria-hidden
    >
      {text}
    </span>
  )
}

const DOT: Record<BotActivity, string> = {
  running: 'bg-yellow-500',
  waiting: 'bg-agent-question',
  paused: 'bg-muted-foreground/50',
  idle: ''
}

export function botActivityLabel(activity: BotActivity): string {
  switch (activity) {
    case 'running':
      return t('Running')
    case 'waiting':
      return t('Waiting on you')
    case 'paused':
      return t('Paused')
    default:
      return ''
  }
}

/** The dot beside a bot: running, waiting on you, or paused; nothing when idle. */
export function BotActivityDot({ activity, className }: { activity: BotActivity; className?: string }) {
  if (activity === 'idle') return null
  return (
    <span
      className={cn('inline-block size-2 shrink-0 rounded-full', DOT[activity], className)}
      title={botActivityLabel(activity)}
      aria-label={botActivityLabel(activity)}
      data-bot-activity={activity}
    />
  )
}
