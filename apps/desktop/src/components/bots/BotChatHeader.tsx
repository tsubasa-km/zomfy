import { ArrowUpRight, MessageSquarePlus } from 'lucide-react'
import { toast } from 'sonner'
import type { BotChatFrom } from '@zomfy/protocol'
import { useStore, type Session } from '@/session-store'
import { botFromLink } from '@/lib/bot-state'
import { openExternalUrl } from '@/lib/link-routing'
import { showThread } from '@/chat-actions'
import { startBotChat, useBots } from '@/stores/bots-store'
import { BotAvatar } from './BotAvatar'
import { t } from '@/i18n/i18n'

// The strip above a bot chat (docs/specs/bots/desktop.md): which bot it is and, for a chat asked
// from elsewhere, where from ("from Discord · asked by Alex"), with a link back.

const SOURCE_LABELS: Record<BotChatFrom['source'], string> = {
  zomfy: 'Zomfy',
  discord: 'Discord',
  slack: 'Slack',
  github: 'GitHub',
  linear: 'Linear',
  webhook: 'Webhook'
}

function FromLine({ from }: { from: BotChatFrom }) {
  const origin = useStore((s) => (from.fromSessionId ? s.sessions.find((x) => x.id === from.fromSessionId) : undefined))
  if (from.source === 'zomfy') {
    if (!from.fromSessionId) return null
    return (
      <button
        type="button"
        data-bot-from-chat={from.fromSessionId}
        onClick={() => showThread(from.fromSessionId!)}
        disabled={!origin}
        className="inline-flex min-w-0 items-center gap-0.5 truncate text-muted-foreground hover:text-foreground disabled:hover:text-muted-foreground"
      >
        {t('from {chat}', { chat: origin?.title ?? t('a chat that is gone') })}
        {origin ? <ArrowUpRight className="size-3 shrink-0" /> : null}
      </button>
    )
  }
  const link = botFromLink(from)
  const label = [t('from {source}', { source: SOURCE_LABELS[from.source] }), from.asker ? t('asked by {name}', { name: from.asker }) : null]
    .filter(Boolean)
    .join(' · ')
  return link ? (
    <button
      type="button"
      data-bot-from-link
      onClick={() => openExternalUrl(link)}
      className="inline-flex min-w-0 items-center gap-0.5 truncate text-muted-foreground hover:text-foreground"
    >
      {label}
      <ArrowUpRight className="size-3 shrink-0" />
    </button>
  ) : (
    <span className="truncate text-muted-foreground">{label}</span>
  )
}

export function BotChatHeader({ session }: { session: Session }) {
  const bot = useBots((s) => (session.botId ? s.bots?.find((b) => b.id === session.botId) : undefined))
  if (session.origin !== 'bot' || session.parentId) return null
  return (
    <div className="mx-auto flex w-full max-w-3xl items-center gap-2 px-6 pt-2 pb-1 text-[12px]" data-bot-chat-header={bot?.handle ?? ''}>
      {bot ? <BotAvatar bot={bot} size={18} /> : null}
      <span className="font-medium">{bot ? bot.name : t('A deleted bot')}</span>
      {bot ? <span className="text-muted-foreground">@{bot.handle}</span> : null}
      {session.botFrom ? (
        <>
          <span className="text-muted-foreground/60">·</span>
          <FromLine from={session.botFrom} />
        </>
      ) : null}
      {bot && !bot.paused ? (
        <button
          type="button"
          data-bot-header-new-chat
          title={t('A new chat with {name}', { name: bot.name })}
          onClick={() =>
            void startBotChat(bot.id).catch((e: unknown) =>
              toast.error(t('The chat did not open'), { description: e instanceof Error ? e.message : String(e) })
            )
          }
          className="ml-auto inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <MessageSquarePlus className="size-3.5" />
          {t('New chat')}
        </button>
      ) : null}
    </div>
  )
}
