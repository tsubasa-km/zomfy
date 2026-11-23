import { useState } from 'react'
import type { Bot, BotNotice } from '@zomfy/protocol'
import { dismissBotNotice } from '@/stores/bots-store'
import { Button } from '@/components/ui/button'
import { BotAvatar } from './BotAvatar'
import { t } from '@/i18n/i18n'

// Something a bot's owner should know (docs/specs/bots/sources/webhooks.md): a webhook refusing
// calls in a burst, or at its run cap. Shown in Needs you until dismissed.

export function botNoticeText(notice: BotNotice): string {
  const hook = notice.hookId ?? '?'
  if (notice.condition === 'refusal_burst') return t('Webhook {hook} refused {n} calls in 10 minutes', { hook, n: notice.count ?? 0 })
  return t('Webhook {hook} reached its run cap', { hook })
}

export function BotNoticeRow({ notice, bot }: { notice: BotNotice; bot: Bot | undefined }) {
  const [error, setError] = useState<string | null>(null)
  return (
    <div className="flex items-center gap-2 py-1.5 text-xs" data-bot-notice={notice.id}>
      {bot ? <BotAvatar bot={bot} size={16} /> : null}
      <span className="min-w-0 flex-1">
        {bot ? <span className="text-muted-foreground">@{bot.handle} · </span> : null}
        {botNoticeText(notice)}
        {error ? <span className="block text-destructive">{error}</span> : null}
      </span>
      <Button
        size="xs"
        variant="outline"
        data-bot-notice-dismiss
        onClick={() => {
          setError(null)
          void dismissBotNotice(notice.id).catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
        }}
      >
        {t('Dismiss')}
      </Button>
    </div>
  )
}
