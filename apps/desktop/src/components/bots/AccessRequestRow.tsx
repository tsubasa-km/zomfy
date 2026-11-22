import { useState } from 'react'
import type { Bot, BotAccessRequest } from '@zomfy/protocol'
import { answerAccessRequest } from '@/stores/bots-store'
import { Button } from '@/components/ui/button'
import { BotAvatar } from './BotAvatar'
import { t } from '@/i18n/i18n'

// Someone on a source asks to use a bot (docs/specs/bots/daemon.md#deliveries): Allow adds them to
// Who can ask; Decline drops the request. Shown in Needs you and on the bot's settings.

function run(task: Promise<unknown>, setError: (error: string | null) => void): void {
  setError(null)
  void task.catch((e) => setError(e instanceof Error ? e.message : String(e)))
}

export function AccessRequestRow({ request, bot }: { request: BotAccessRequest; bot: Bot | undefined }) {
  const [error, setError] = useState<string | null>(null)
  return (
    <div className="flex items-center gap-2 py-1.5 text-xs" data-access-request={request.id}>
      {bot ? <BotAvatar bot={bot} size={16} /> : null}
      <span className="min-w-0 flex-1">
        {t('{name} on {source} asks to use {bot}', { name: request.requester.name, source: request.source, bot: bot ? `@${bot.handle}` : t('a bot') })}
        {request.message ? <span className="block truncate text-muted-foreground">“{request.message}”</span> : null}
        {error ? <span className="block text-destructive">{error}</span> : null}
      </span>
      <Button size="xs" data-access-allow onClick={() => run(answerAccessRequest(request.id, true), setError)}>
        {t('Allow')}
      </Button>
      <Button size="xs" variant="outline" data-access-decline onClick={() => run(answerAccessRequest(request.id, false), setError)}>
        {t('Decline')}
      </Button>
    </div>
  )
}
