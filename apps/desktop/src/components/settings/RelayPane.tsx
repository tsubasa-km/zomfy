import { useMemo, useState } from 'react'
import { Bot, ExternalLink, RefreshCw } from 'lucide-react'
import type { ConnectorStatus } from '@zomfy/protocol'
import { pairConnector, unpairConnector, useBots } from '@/stores/bots-store'
import { setSetting, useSetting } from '@/stores/settings-store'
import { openExternalUrl } from '@/lib/link-routing'
import {
  checkRelayHealth,
  featuresValue,
  RELAY_DEPLOY_URL,
  RELAY_README_URL,
  relayBase,
  relayFeatureInfo,
  relayFeatureState,
  type RelayFeatureInfo,
  type RelayFeatureState,
  type RelayHealth
} from '@/lib/relay-features'
import { CopyField } from '@/components/bots/CopyField'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { SettingsSubsectionHeader } from './settings-form-controls'
import { RelaySetupDialog } from './RelaySetupDialog'
import { t } from '@/i18n/i18n'

// Settings → Zomfy Relay (docs/specs/relay-settings.md#settings--zomfy-relay): the one relay this
// computer pairs with, what it serves, the features the person wants and what each needs.

const CARD = 'space-y-2 rounded-lg border border-border/60 bg-background/40 px-4 py-3'

export function relayStateLabel(state: ConnectorStatus['state']): string {
  switch (state) {
    case 'online':
      return t('Connected')
    case 'connecting':
      return t('Connecting…')
    case 'offline':
      return t('Offline, retrying')
    case 'unauthorized':
      return t('Refused: pair again')
    default:
      return t('Not paired')
  }
}

export function RelayStateDot({ state }: { state: ConnectorStatus['state'] }) {
  return (
    <span
      className={cn(
        'inline-block size-2 shrink-0 rounded-full',
        state === 'online' ? 'bg-status-success' : state === 'unauthorized' ? 'bg-destructive' : state === 'unpaired' ? 'bg-muted-foreground/50' : 'bg-yellow-500'
      )}
    />
  )
}

function run(task: Promise<unknown>, setError: (error: string | null) => void): void {
  setError(null)
  void task.catch((e) => setError(e instanceof Error ? e.message : String(e)))
}

/** The relay's features as a line of names, from its health. */
function ServedFeatures({ health, info }: { health: RelayHealth; info: RelayFeatureInfo[] }) {
  const served = info.filter((f) => relayFeatureState(f.id, health).kind === 'on')
  return (
    <span className="flex flex-wrap gap-1" data-relay-served>
      {served.length === 0 ? <span className="text-muted-foreground">{t('None')}</span> : null}
      {served.map((f) => (
        <span key={f.id} className="rounded bg-status-success/15 px-1.5 text-[11px] text-status-success" data-relay-served-feature={f.id}>
          {f.label}
        </span>
      ))}
    </span>
  )
}

function StatusSection({
  status,
  health,
  onHealth,
  info
}: {
  status: ConnectorStatus | null
  health: RelayHealth | null
  onHealth: (health: RelayHealth | null) => void
  info: RelayFeatureInfo[]
}) {
  const [url, setUrl] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const paired = status !== null && status.state !== 'unpaired'
  const check = (target: string) => {
    setChecking(true)
    setError(null)
    checkRelayHealth(target)
      .then(onHealth)
      .catch((e: unknown) => {
        onHealth(null)
        setError(e instanceof Error ? e.message : String(e))
      })
      .finally(() => setChecking(false))
  }
  return (
    <div className={CARD} data-relay-status>
      <SettingsSubsectionHeader
        title={t('Status')}
        description={t('One Worker on your own Cloudflare account carries both the phone app and the bots’ sources to this computer.')}
      />
      {paired && status ? (
        <div className="space-y-2">
          <p className="flex items-center gap-2 text-sm" data-relay-state={status.state}>
            <RelayStateDot state={status.state} />
            {relayStateLabel(status.state)}
          </p>
          <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1 text-xs">
            <dt className="text-muted-foreground">{t('Worker URL')}</dt>
            <dd className="truncate">{status.relayUrl}</dd>
            <dt className="text-muted-foreground">{t('Host id')}</dt>
            <dd className="truncate font-mono" data-relay-host-id>
              {status.hostId}
            </dd>
            <dt className="text-muted-foreground">{t('Last hello')}</dt>
            <dd>{status.lastConnectedAt ? new Date(status.lastConnectedAt).toLocaleString() : t('Not yet')}</dd>
            {status.retryAt && status.state === 'offline' ? (
              <>
                <dt className="text-muted-foreground">{t('Next try')}</dt>
                <dd>{new Date(status.retryAt).toLocaleTimeString()}</dd>
              </>
            ) : null}
            {health?.relayVersion ? (
              <>
                <dt className="text-muted-foreground">{t('Relay version')}</dt>
                <dd>{health.relayVersion}</dd>
              </>
            ) : null}
            <dt className="text-muted-foreground">{t('Serves')}</dt>
            <dd>{health ? <ServedFeatures health={health} info={info} /> : t('Not read yet')}</dd>
            {health?.featuresFrom ? (
              <>
                <dt className="text-muted-foreground">{t('Chosen by')}</dt>
                <dd>{health.featuresFrom === 'FEATURES' ? t('its FEATURES variable') : t('which secrets are set')}</dd>
              </>
            ) : null}
          </dl>
          {status.error ? <p className="text-xs text-destructive">{status.error}</p> : null}
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" data-relay-check disabled={checking || !status.relayUrl} onClick={() => status.relayUrl && check(status.relayUrl)}>
              <RefreshCw />
              {checking ? t('Checking…') : t('Check now')}
            </Button>
            <Button variant="outline" size="sm" data-relay-unpair onClick={() => run(unpairConnector(), setError)}>
              {t('Unpair')}
            </Button>
          </div>
        </div>
      ) : (
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (!url.trim() || !code.trim() || busy) return
            setBusy(true)
            run(
              pairConnector(url, code).finally(() => setBusy(false)),
              setError
            )
          }}
        >
          <p className="flex items-center gap-2 text-sm" data-relay-state="unpaired">
            <RelayStateDot state="unpaired" />
            {t('Not paired')}
          </p>
          <div className="grid gap-2 sm:grid-cols-[1fr_14rem]">
            <Input value={url} data-relay-url placeholder={t('Worker URL, https://zomfy-relay.<you>.workers.dev')} onChange={(e) => setUrl(e.target.value)} />
            <Input value={code} data-relay-setup-code type="password" placeholder={t('Setup code')} onChange={(e) => setCode(e.target.value)} />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" size="sm" disabled={!url.trim() || !code.trim() || busy} data-relay-pair>
              {t('Pair')}
            </Button>
            <Button type="button" variant="outline" size="sm" disabled={!relayBase(url) || checking} data-relay-check onClick={() => check(url)}>
              <RefreshCw />
              {checking ? t('Checking…') : t('Check')}
            </Button>
            <span className="text-xs text-muted-foreground">{t('Check reads what a relay serves before you pair with it.')}</span>
          </div>
          {health ? (
            <p className="flex flex-wrap items-center gap-2 text-xs" data-relay-checked>
              <span className="text-muted-foreground">{health.relayVersion ? t('Zomfy Relay {version} serves', { version: health.relayVersion }) : t('It serves')}</span>
              <ServedFeatures health={health} info={info} />
            </p>
          ) : null}
        </form>
      )}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  )
}

function stateBadge(state: RelayFeatureState): { label: string; className: string } {
  switch (state.kind) {
    case 'on':
      return { label: t('On'), className: 'bg-status-success/15 text-status-success' }
    case 'needs':
      return { label: t('Needs secrets'), className: 'bg-yellow-500/15 text-yellow-600 dark:text-yellow-400' }
    case 'off':
      return { label: t('Off on the relay'), className: 'bg-muted text-muted-foreground' }
    default:
      return { label: t('Check the relay'), className: 'bg-muted text-muted-foreground' }
  }
}

function FeatureNeeds({ feature, state, base }: { feature: RelayFeatureInfo; state: RelayFeatureState; base: string | null }) {
  const badge = stateBadge(state)
  const missing = state.kind === 'needs' ? new Set(state.secrets) : null
  return (
    <div className="space-y-1.5 rounded-md border border-border/50 px-3 py-2" data-relay-feature-needs={feature.id}>
      <p className="flex items-center gap-2 text-sm font-medium">
        {feature.label}
        <span className={cn('rounded px-1.5 text-[10px]', badge.className)} data-relay-feature-state={state.kind}>
          {badge.label}
        </span>
      </p>
      <p className="text-xs text-muted-foreground">{feature.steps}</p>
      {feature.secrets.length > 0 ? (
        <ul className="grid gap-0.5 text-xs">
          {feature.secrets.map((secret) => (
            <li key={secret.name} className="flex flex-wrap items-baseline gap-x-2">
              <code className={cn('rounded px-1', missing?.has(secret.name) ? 'bg-yellow-500/15' : 'bg-muted')}>{secret.name}</code>
              <span className="text-muted-foreground">{secret.where}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {base && state.kind === 'on'
        ? feature.urls(base).map((u) => (
            <div key={u.url} className="space-y-0.5">
              <p className="text-[11px] text-muted-foreground">{u.label}</p>
              <CopyField value={u.url} />
            </div>
          ))
        : null}
      <button
        type="button"
        className="text-[11px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
        onClick={() => openExternalUrl(feature.guide)}
      >
        {t('Setup steps')}
      </button>
    </div>
  )
}

function FeaturesSection({ health, base, info }: { health: RelayHealth | null; base: string | null; info: RelayFeatureInfo[] }) {
  const wanted = useSetting('relayFeatures')
  const toggle = (id: string, on: boolean) => {
    const next = on ? [...wanted.filter((f) => f !== id), id] : wanted.filter((f) => f !== id)
    setSetting('relayFeatures', info.map((f) => f.id).filter((f) => next.includes(f)))
  }
  const value = featuresValue(wanted)
  return (
    <div className={CARD} data-relay-features>
      <SettingsSubsectionHeader title={t('Features')} description={t('Tick what you want the relay for. Each shows what it needs and whether your relay has it.')} />
      <div className="flex flex-wrap gap-x-5 gap-y-2">
        {info.map((f) => (
          <label key={f.id} className="flex items-center gap-2 text-sm">
            <Checkbox checked={wanted.includes(f.id)} data-relay-feature={f.id} onCheckedChange={(v) => toggle(f.id, v === true)} />
            {f.label}
          </label>
        ))}
      </div>
      {wanted.length === 0 ? <p className="py-1 text-xs text-muted-foreground">{t('Tick a feature to see what it needs.')}</p> : null}
      <div className="grid gap-2 sm:grid-cols-2">
        {info
          .filter((f) => wanted.includes(f.id))
          .map((f) => (
            <FeatureNeeds key={f.id} feature={f} state={relayFeatureState(f.id, health)} base={base} />
          ))}
      </div>
      {value ? (
        <div className="space-y-0.5 pt-1">
          <p className="text-[11px] text-muted-foreground">
            {t('To serve only these, set FEATURES on the Worker to this (unset, the relay serves the phone, webhooks and every source with its secrets):')}
          </p>
          <CopyField value={value} data="relay-features-value" />
        </div>
      ) : null}
    </div>
  )
}

function SetupSection({ relayUrl }: { relayUrl: string | null }) {
  const wanted = useSetting('relayFeatures')
  const [open, setOpen] = useState(false)
  return (
    <div className={CARD} data-relay-setup>
      <SettingsSubsectionHeader
        title={t('Set up')}
        description={t('Deploy the relay to your Cloudflare account and give it the secrets the ticked features need, or let an agent walk you through it.')}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" disabled={wanted.length === 0} data-relay-setup-agent onClick={() => setOpen(true)}>
          <Bot />
          {t('Set up with an agent')}
        </Button>
        <Button variant="outline" size="sm" onClick={() => openExternalUrl(RELAY_DEPLOY_URL)}>
          <ExternalLink />
          {t('Deploy to Cloudflare')}
        </Button>
        <Button variant="outline" size="sm" onClick={() => openExternalUrl(RELAY_README_URL)}>
          <ExternalLink />
          {t('Guide')}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        {t('or run')} <code>bun run deploy</code> {t('in apps/relay;')} <code>bun run relay:local</code> {t('runs it on this computer instead.')}
      </p>
      <RelaySetupDialog open={open} onOpenChange={setOpen} features={wanted} relayUrl={relayUrl} />
    </div>
  )
}

export function RelayPane() {
  const status = useBots((s) => s.connector)
  const [checked, setChecked] = useState<{ url: string; health: RelayHealth } | null>(null)
  const info = useMemo(() => relayFeatureInfo(), [])
  const paired = status !== null && status.state !== 'unpaired'
  const relayUrl = paired ? status.relayUrl : null
  // A Check of this relay is newer than the daemon's last read; otherwise the daemon's.
  const fromDaemon: RelayHealth | null = paired && status && (status.features || status.sources.length > 0 || status.state === 'online') ? status : null
  const health = checked && (!paired || checked.url === relayUrl) ? checked.health : fromDaemon
  const base = relayUrl ? relayBase(relayUrl) : null
  return (
    <div className="space-y-4">
      <StatusSection
        status={status}
        health={health}
        info={info}
        onHealth={(next) => setChecked(next ? { url: relayUrl ?? '', health: next } : null)}
      />
      <FeaturesSection health={health} base={base} info={info} />
      <SetupSection relayUrl={relayUrl} />
    </div>
  )
}
