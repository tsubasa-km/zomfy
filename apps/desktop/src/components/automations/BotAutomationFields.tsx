import { useMemo, useState } from 'react'
import { useStore } from '@/session-store'
import { botAction } from '@/stores/bots-store'
import { botChats } from '@/lib/bot-state'
import { BOT_TRIGGER_KINDS, BOT_TRIGGER_SOURCES, mintedHook, type BotAutomationDraft, type BotTriggerSource } from '@/lib/bot-automation'
import { CopyField } from '@/components/bots/CopyField'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { t } from '@/i18n/i18n'

// The bot part of the automation editor (docs/specs/bots/daemon.md#schedules-and-triggers): where
// the run happens and where its result goes, and for a trigger the source event that starts it.

const SOURCE_LABEL: Record<BotTriggerSource, string> = {
  discord: 'Discord',
  slack: 'Slack',
  github: 'GitHub',
  linear: 'Linear',
  webhook: t('Webhook')
}

const PLACES_HINT: Record<BotTriggerSource, string> = {
  discord: 'discord:<guild>:<channel>',
  slack: 'slack:<team>:<channel>',
  github: 'github:<installation>:<owner/repo>',
  linear: 'linear:<org>:<ENG-123>',
  webhook: ''
}

export function BotAutomationFields({
  draft,
  isNew,
  onChange
}: {
  draft: BotAutomationDraft
  isNew: boolean
  onChange: (change: Partial<BotAutomationDraft>) => void
}) {
  const sessions = useStore((s) => s.sessions)
  const chats = useMemo(() => botChats(sessions, draft.botId), [sessions, draft.botId])
  // 'thread' is the chat's own thread in a source, so it needs a chat to continue.
  const offerThread = draft.runsIn === 'chat' || draft.resultsTo === 'thread'
  return (
    <div className="grid gap-4" data-bot-automation-fields>
      {draft.mode === 'trigger' ? <TriggerFields draft={draft} isNew={isNew} onChange={onChange} /> : null}
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('Runs in')}>
          <Select
            value={draft.runsIn}
            onValueChange={(value) => {
              if (value === 'new') onChange({ runsIn: 'new', ...(draft.resultsTo === 'thread' ? { resultsTo: 'chat' } : {}) })
              if (value === 'chat') onChange({ runsIn: 'chat', chat: draft.chat || chats[0]?.id || '' })
            }}
          >
            <SelectTrigger className="w-full" data-automation-field="runs-in">
              <SelectValue />
            </SelectTrigger>
            <SelectContent position="popper">
              <SelectItem value="new">{t('A new chat each run')}</SelectItem>
              <SelectItem value="chat" disabled={chats.length === 0 && !draft.chat}>
                {t('One chat, continued')}
              </SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field label={t('Results go to')}>
          <Select
            value={draft.resultsTo}
            onValueChange={(value) => {
              if (value === 'chat' || value === 'thread' || value === 'none' || value === 'ref') onChange({ resultsTo: value })
            }}
          >
            <SelectTrigger className="w-full" data-automation-field="results-to">
              <SelectValue />
            </SelectTrigger>
            <SelectContent position="popper">
              <SelectItem value="chat">{t('Its chat')}</SelectItem>
              {offerThread ? <SelectItem value="thread">{t('The thread it runs for')}</SelectItem> : null}
              <SelectItem value="none">{t('Nowhere')}</SelectItem>
              <SelectItem value="ref">{t('A place')}</SelectItem>
            </SelectContent>
          </Select>
        </Field>
      </div>
      {draft.runsIn === 'chat' ? (
        <Field label={t('Chat')}>
          <Select value={draft.chat} onValueChange={(chat) => onChange({ chat })}>
            <SelectTrigger className="w-full" data-automation-field="chat">
              <SelectValue placeholder={t('Pick a chat')} />
            </SelectTrigger>
            <SelectContent position="popper">
              {draft.chat && !chats.some((c) => c.id === draft.chat) ? <SelectItem value={draft.chat}>{draft.chat}</SelectItem> : null}
              {chats.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.title || c.id}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      ) : null}
      {draft.resultsTo === 'ref' ? (
        <Field label={t('Place')} hint={t('A Discord or Slack channel, or a Linear issue, as a ref.')}>
          <Input
            value={draft.resultsRef}
            placeholder="discord:<guild>:<channel>"
            data-automation-field="results-ref"
            onChange={(e) => onChange({ resultsRef: e.target.value })}
          />
        </Field>
      ) : null}
    </div>
  )
}

function TriggerFields({
  draft,
  isNew,
  onChange
}: {
  draft: BotAutomationDraft
  isNew: boolean
  onChange: (change: Partial<BotAutomationDraft>) => void
}) {
  const kinds = BOT_TRIGGER_KINDS[draft.source]
  const toggle = (kind: string, on: boolean) =>
    onChange({ kinds: on ? [...draft.kinds.filter((k) => k !== kind), kind] : draft.kinds.filter((k) => k !== kind) })
  return (
    <>
      <Field label={t('Source')}>
        <Select
          value={draft.source}
          disabled={!isNew}
          onValueChange={(value) => {
            const source = BOT_TRIGGER_SOURCES.find((s) => s === value)
            if (source && source !== draft.source) onChange({ source, kinds: [], places: '' })
          }}
        >
          <SelectTrigger className="w-full" data-automation-field="source">
            <SelectValue />
          </SelectTrigger>
          <SelectContent position="popper">
            {BOT_TRIGGER_SOURCES.map((s) => (
              <SelectItem key={s} value={s}>
                {SOURCE_LABEL[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      {draft.source === 'webhook' ? (
        <WebhookFields draft={draft} isNew={isNew} onChange={onChange} />
      ) : (
        <>
          {kinds.length > 1 ? (
            <Field label={t('Events')} hint={t('None ticked means any of them.')}>
              <div className="grid grid-cols-2 gap-x-3 gap-y-1" data-automation-field="kinds">
                {kinds.map((kind) => (
                  <label key={kind} className="flex items-center gap-2 text-xs">
                    <Checkbox checked={draft.kinds.includes(kind)} onCheckedChange={(v) => toggle(kind, v === true)} />
                    <code>{kind}</code>
                  </label>
                ))}
              </div>
            </Field>
          ) : null}
          <Field label={t('Places')} hint={t('Refs, one per line, such as {example}. None means anywhere.', { example: PLACES_HINT[draft.source] })}>
            <Textarea
              value={draft.places}
              rows={2}
              data-automation-field="places"
              onChange={(e) => onChange({ places: e.target.value })}
            />
          </Field>
          <Field label={t('Only from')} hint={t("People's ids in the source, separated by commas. Empty means anyone who can ask.")}>
            <Input value={draft.from} data-automation-field="from" onChange={(e) => onChange({ from: e.target.value })} />
          </Field>
        </>
      )}
      <Field label={t('Text contains')} hint={t('Only events whose text contains this, in any case.')}>
        <Input value={draft.textContains} data-automation-field="text-contains" onChange={(e) => onChange({ textContains: e.target.value })} />
      </Field>
    </>
  )
}

function WebhookFields({
  draft,
  isNew,
  onChange
}: {
  draft: BotAutomationDraft
  isNew: boolean
  onChange: (change: Partial<BotAutomationDraft>) => void
}) {
  const [minted, setMinted] = useState<{ url: string; key: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const mint = () => {
    setBusy(true)
    setError(null)
    botAction('webhook.mint', { botId: draft.botId })
      .then((result) => {
        const hook = mintedHook(result)
        if (!hook) throw new Error(t('The relay answered without a webhook URL.'))
        setMinted({ url: hook.url, key: hook.key })
        onChange({ hookId: hook.hookId })
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false))
  }
  return (
    <div className="grid gap-2 rounded-md border border-border/60 px-3 py-2" data-automation-webhook>
      {minted ? (
        <>
          <Label className="text-xs">{t('Webhook URL')}</Label>
          <CopyField value={minted.url} data="webhook-url" />
          <Label className="text-xs">{t('Key')}</Label>
          <CopyField value={minted.key} data="webhook-key" />
          <p className="text-[11px] text-muted-foreground">
            {t('The key is shown only now. Send it as a Bearer token, or add it to the URL as /<key>.')}
          </p>
        </>
      ) : draft.hookId ? (
        <p className="text-xs">
          {t('Webhook')} <code>{draft.hookId}</code>
        </p>
      ) : isNew ? (
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" disabled={busy} data-automation-webhook-mint onClick={mint}>
            {busy ? t('Creating…') : t('Create webhook URL')}
          </Button>
          <span className="text-[11px] text-muted-foreground">{t('Each trigger gets a URL of its own from your relay.')}</span>
        </div>
      ) : null}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="grid min-w-0 gap-1.5">
      <Label className="text-xs">{label}</Label>
      {children}
      {hint ? <p className="text-[11px] text-muted-foreground">{hint}</p> : null}
    </div>
  )
}
