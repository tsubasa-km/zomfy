import { useMemo, useState } from 'react'
import { Bot as BotIcon, MessageSquarePlus, Plus, Settings2 } from 'lucide-react'
import { toast } from 'sonner'
import type { Bot } from '@zomfy/protocol'
import { useStore } from '@/session-store'
import { botActivity, botBadges, botChats } from '@/lib/bot-state'
import { openBot, selectBot, setBotsPageOpen, startBotChat, useBots } from '@/stores/bots-store'
import { openSettings } from '@/stores/app-overlay-store'
import { showThread } from '@/chat-actions'
import { PageCloseButton } from '@/components/PageCloseButton'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { BotActivityDot, BotAvatar } from './BotAvatar'
import { BotEditorDialog } from './BotEditorDialog'
import { t } from '@/i18n/i18n'

// The page the sidebar's Bots row opens (docs/specs/bots/desktop.md, like Orca's): one row per bot.
// Clicking a bot opens its newest chat; New chat opens another in its home.

function failed(title: string) {
  return (error: unknown) => toast.error(title, { description: error instanceof Error ? error.message : String(error) })
}

function relative(at: number): string {
  const minutes = Math.round((Date.now() - at) / 60_000)
  if (minutes < 1) return t('just now')
  if (minutes < 60) return t('{n} min ago', { n: minutes })
  const hours = Math.round(minutes / 60)
  if (hours < 24) return t('{n} h ago', { n: hours })
  return new Date(at).toLocaleDateString()
}

function BotRow({ bot }: { bot: Bot }) {
  const sessions = useStore((s) => s.sessions)
  const chats = useMemo(() => botChats(sessions, bot.id), [sessions, bot.id])
  const activity = useMemo(() => botActivity(bot, sessions), [bot, sessions])
  return (
    <div className="rounded-lg border border-border/60 bg-card/40 px-3 py-2.5" data-bot-row={bot.handle}>
      <div className="flex items-center gap-3">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
          data-bot-open={bot.handle}
          onClick={() => void openBot(bot).catch(failed(t('The chat did not open')))}
        >
          <BotAvatar bot={bot} size={32} />
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-2 text-[13px] font-medium">
              <span className="truncate">{bot.name}</span>
              <span className="text-[11px] font-normal text-muted-foreground">@{bot.handle}</span>
              {botBadges(bot).map((badge) => (
                <span key={badge} className="rounded bg-muted px-1 text-[10px] text-muted-foreground" data-bot-badge={badge}>
                  {badge === 'Master' ? t('Master') : t('Default')}
                </span>
              ))}
              <BotActivityDot activity={activity} />
            </span>
            <span className="block truncate text-[11px] text-muted-foreground">
              {bot.paused ? t('Paused: it takes no new requests.') : bot.purpose || t('No purpose given; SOUL.md says who it is.')}
            </span>
          </span>
        </button>
        <Button
          size="xs"
          variant="outline"
          data-bot-new-chat={bot.handle}
          disabled={bot.paused}
          onClick={() => void startBotChat(bot.id).catch(failed(t('The chat did not open')))}
        >
          <MessageSquarePlus />
          {t('New chat')}
        </Button>
        <Button
          size="icon-xs"
          variant="ghost"
          aria-label={t('Bot settings')}
          title={t('Bot settings')}
          data-bot-settings={bot.handle}
          onClick={() => {
            selectBot(bot.id)
            openSettings('bots')
          }}
        >
          <Settings2 />
        </Button>
      </div>
      {chats.length > 0 ? (
        <ul className="mt-2 flex flex-col gap-0.5 border-t border-border/40 pt-1.5">
          {chats.slice(0, 5).map((chat) => (
            <li key={chat.id}>
              <button
                type="button"
                data-bot-chat={chat.id}
                onClick={() => showThread(chat.id)}
                className="flex w-full items-center gap-2 rounded px-1.5 py-0.5 text-left text-[12px] text-foreground/85 hover:bg-accent/50"
              >
                <span
                  className={cn(
                    'size-1.5 shrink-0 rounded-full',
                    chat.status === 'needs-you' ? 'bg-agent-question' : chat.status === 'working' ? 'bg-yellow-500' : 'bg-muted-foreground/30'
                  )}
                />
                <span className="min-w-0 flex-1 truncate">{chat.title}</span>
                {chat.botFrom && chat.botFrom.source !== 'zomfy' ? (
                  <span className="shrink-0 text-[10px] text-muted-foreground capitalize">{chat.botFrom.source}</span>
                ) : null}
                <span className="shrink-0 text-[10px] text-muted-foreground tabular-nums">{relative(chat.lastActivityAt ?? chat.createdAt)}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

export function BotsPage() {
  const bots = useBots((s) => s.bots)
  const [creating, setCreating] = useState(false)
  return (
    <div
      className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background"
      data-bots-page
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || event.defaultPrevented || creating) return
        setBotsPageOpen(false)
      }}
    >
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-3">
        <PageCloseButton label={t('Close bots')} onClick={() => setBotsPageOpen(false)} />
        <BotIcon className="size-4 text-muted-foreground" />
        <h1 className="text-[13px] font-semibold">{t('Bots')}</h1>
        <span className="text-[11px] text-muted-foreground">{t('Named agents with a home folder, asked from Zomfy, Discord and more')}</span>
        <Button size="sm" variant="ghost" className="ml-auto" onClick={() => openSettings('bots')}>
          <Settings2 />
          {t('Settings')}
        </Button>
        <Button size="sm" data-bot-create onClick={() => setCreating(true)}>
          <Plus />
          {t('Create bot')}
        </Button>
      </div>
      <div className="scrollbar-sleek min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-3xl flex-col gap-2 p-4">
          {bots === null ? (
            <p className="py-6 text-center text-xs text-muted-foreground">{t('This computer’s daemon has no bots yet; update Zomfy to use them.')}</p>
          ) : bots.length === 0 ? (
            <div className="flex flex-col items-center gap-3 py-10 text-center">
              <BotIcon className="size-8 text-muted-foreground/60" />
              <p className="max-w-sm text-sm text-muted-foreground">
                {t('No bots yet. A bot lives in a folder with its SOUL.md and MEMORY.md, and you can talk to it here with no cloud set up.')}
              </p>
              <Button size="sm" onClick={() => setCreating(true)}>
                <Plus />
                {t('Create bot')}
              </Button>
            </div>
          ) : (
            bots.map((bot) => <BotRow key={bot.id} bot={bot} />)
          )}
        </div>
      </div>
      <BotEditorDialog
        open={creating}
        existing={null}
        onOpenChange={setCreating}
        onSaved={(bot) => toast.success(t('{name} is ready. Click it to talk to it.', { name: bot.name }))}
      />
    </div>
  )
}
