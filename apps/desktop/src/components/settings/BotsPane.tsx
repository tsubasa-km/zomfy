import { useMemo, useState } from 'react'
import { ArrowLeft, Check, Copy, ExternalLink, FileText, FolderOpen, Pencil, Plus, Trash2, X } from 'lucide-react'
import type { Bot, BotAsker, BotSource, ConnectorStatus } from '@zomfy/protocol'
import { allWorkspaces, LOCAL_HOST, openEditorTab, selectWorkspace, useStore } from '@/session-store'
import {
  deleteBot,
  pairConnector,
  pauseBot,
  selectBot,
  setBotAskers,
  unpairConnector,
  updateBot,
  useBots
} from '@/stores/bots-store'
import { closeSettings } from '@/stores/app-overlay-store'
import { openExternalUrl } from '@/lib/link-routing'
import { openWorkspaceIn } from '@/components/sidebar/WorkspaceMenu'
import { BotAvatar } from '@/components/bots/BotAvatar'
import { BotEditorDialog } from '@/components/bots/BotEditorDialog'
import { AccessRequestRow } from '@/components/bots/AccessRequestRow'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import { SettingsSubsectionHeader } from './settings-form-controls'
import { t } from '@/i18n/i18n'

// Settings → Bots (docs/specs/bots/desktop.md#settings--bots): the relay this computer pairs with,
// the sources the deployment has, and each bot: its files, Who can ask, pause and delete.

const REPO = 'https://github.com/tsubasa-km/zomfy'
const DEPLOY_URL = `https://deploy.workers.cloudflare.com/?url=${REPO}/tree/main/apps/relay`
const GUIDE_URL = `${REPO}/blob/main/docs/specs/bots/connector.md#deploy`

const ASK_SOURCES: { id: BotSource; label: string; findId: string }[] = [
  {
    id: 'discord',
    label: 'Discord',
    findId: t('In Discord, turn on Developer Mode (Settings → Advanced), then right-click your name and choose Copy User ID.')
  },
  { id: 'slack', label: 'Slack', findId: t('In Slack, open your profile, choose ⋮ and Copy member ID.') },
  { id: 'github', label: 'GitHub', findId: t('Your GitHub login, as in github.com/<login>.') },
  { id: 'linear', label: 'Linear', findId: t('In Linear, open your profile; the id is in the URL after /profiles/.') }
]

function run(task: Promise<unknown>, setError: (error: string | null) => void): void {
  setError(null)
  void task.catch((e) => setError(e instanceof Error ? e.message : String(e)))
}

function CopyField({ value, data }: { value: string; data?: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="flex items-center gap-2">
      <code className="min-w-0 flex-1 truncate rounded bg-muted px-2 py-1 text-xs select-all" data-copy-field={data}>
        {value}
      </code>
      <Button variant="outline" size="xs" onClick={() => void navigator.clipboard.writeText(value).then(() => setCopied(true))}>
        {copied ? <Check /> : <Copy />}
        {copied ? t('Copied') : t('Copy')}
      </Button>
    </div>
  )
}

function stateLabel(state: ConnectorStatus['state']): string {
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

function RelaySection({ status }: { status: ConnectorStatus | null }) {
  const [url, setUrl] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const paired = status !== null && status.state !== 'unpaired'
  const pair = () => {
    setBusy(true)
    run(
      pairConnector(url, code).finally(() => setBusy(false)),
      setError
    )
  }
  return (
    <div className="space-y-2 rounded-lg border border-border/60 bg-background/40 px-4 py-3" data-bots-relay>
      <SettingsSubsectionHeader
        title={t('Relay')}
        description={t('Your own Zomfy Relay on Cloudflare carries Discord and other sources to this computer. The same relay serves the phone. Bots answer in Zomfy without one.')}
      />
      {paired && status ? (
        <div className="space-y-2">
          <p className="flex items-center gap-2 text-sm" data-relay-state={status.state}>
            <span
              className={cn(
                'inline-block size-2 rounded-full',
                status.state === 'online' ? 'bg-status-success' : status.state === 'unauthorized' ? 'bg-destructive' : 'bg-yellow-500'
              )}
            />
            {stateLabel(status.state)}
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
          </dl>
          {status.error ? <p className="text-xs text-destructive">{status.error}</p> : null}
          <Button variant="outline" size="sm" data-relay-unpair onClick={() => run(unpairConnector(), setError)}>
            {t('Unpair')}
          </Button>
        </div>
      ) : (
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (url.trim() && code.trim() && !busy) pair()
          }}
        >
          <div className="grid gap-2 sm:grid-cols-[1fr_14rem]">
            <Input value={url} data-relay-url placeholder={t('Worker URL, https://zomfy-relay.<you>.workers.dev')} onChange={(e) => setUrl(e.target.value)} />
            <Input value={code} data-relay-setup-code type="password" placeholder={t('Setup code')} onChange={(e) => setCode(e.target.value)} />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" size="sm" disabled={!url.trim() || !code.trim() || busy} data-relay-pair>
              {t('Pair')}
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => openExternalUrl(DEPLOY_URL)}>
              <ExternalLink />
              {t('Deploy to Cloudflare')}
            </Button>
            <span className="text-xs text-muted-foreground">
              {t('or run')} <code>bun run deploy</code> {t('in apps/relay;')}{' '}
              <button type="button" className="underline underline-offset-2 hover:text-foreground" onClick={() => openExternalUrl(GUIDE_URL)}>
                {t('the guide')}
              </button>
            </span>
          </div>
        </form>
      )}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  )
}

const SOURCE_CARDS: { id: string; label: string; urls: (base: string) => { label: string; url: string }[]; guide: string }[] = [
  {
    id: 'discord',
    label: 'Discord',
    urls: (base) => [{ label: t('Interactions endpoint URL'), url: `${base}/discord/interactions` }],
    guide: 'sources/discord.md'
  },
  { id: 'slack', label: 'Slack', urls: () => [], guide: 'sources/slack.md' },
  { id: 'github', label: 'GitHub', urls: () => [], guide: 'sources/github.md' },
  { id: 'linear', label: 'Linear', urls: () => [], guide: 'sources/linear.md' },
  { id: 'webhooks', label: t('Webhooks'), urls: () => [], guide: 'sources/webhooks.md' }
]

function SourcesSection({ status }: { status: ConnectorStatus | null }) {
  const base = status?.relayUrl?.replace(/\/+$/, '') ?? null
  return (
    <div className="space-y-2 rounded-lg border border-border/60 bg-background/40 px-4 py-3" data-bots-sources>
      <SettingsSubsectionHeader title={t('Sources')} description={t('Where bots can be asked. A source is on when the relay has its secrets.')} />
      <div className="grid gap-2 sm:grid-cols-2">
        {SOURCE_CARDS.map((source) => {
          const on = status?.sources.includes(source.id) ?? false
          return (
            <div key={source.id} className="space-y-1.5 rounded-md border border-border/50 px-3 py-2" data-bots-source={source.id}>
              <p className="flex items-center gap-2 text-sm font-medium">
                {source.label}
                <span className={cn('rounded px-1.5 text-[10px]', on ? 'bg-status-success/15 text-status-success' : 'bg-muted text-muted-foreground')}>
                  {on ? t('Configured') : base ? t('Not configured') : t('No relay')}
                </span>
              </p>
              {base && on
                ? source.urls(base).map((u) => (
                    <div key={u.url} className="space-y-0.5">
                      <p className="text-[11px] text-muted-foreground">{u.label}</p>
                      <CopyField value={u.url} />
                    </div>
                  ))
                : null}
              <button
                type="button"
                className="text-[11px] text-muted-foreground underline underline-offset-2 hover:text-foreground"
                onClick={() => openExternalUrl(`${REPO}/blob/main/docs/specs/bots/${source.guide}`)}
              >
                {t('Setup steps')}
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function homeOf(bot: Bot, workspaces: { id: string; path: string }[]): string | null {
  return workspaces.find((w) => w.id === bot.homeWorkspaceId)?.path ?? null
}

function openHomeFile(bot: Bot, path: string): void {
  closeSettings()
  selectWorkspace(bot.homeWorkspaceId)
  openEditorTab({ workspaceId: bot.homeWorkspaceId, kind: 'file', path, staged: false })
}

function AskersEditor({ bot, source }: { bot: Bot; source: (typeof ASK_SOURCES)[number] }) {
  const [owner, setOwner] = useState(bot.owner[source.id] ?? '')
  const [newId, setNewId] = useState('')
  const [newName, setNewName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const askers = bot.askers[source.id] ?? []
  const saveOwner = () => {
    const id = owner.trim()
    if (id === (bot.owner[source.id] ?? '')) return
    const next = { ...bot.owner }
    if (id) next[source.id] = id
    else delete next[source.id]
    run(updateBot(bot.id, { owner: next }), setError)
  }
  const add = () => {
    const id = newId.trim()
    if (!id) return
    const asker: BotAsker = { id, role: 'member', ...(newName.trim() ? { name: newName.trim() } : {}) }
    run(
      setBotAskers(bot.id, source.id, [...askers, asker]).then(() => {
        setNewId('')
        setNewName('')
      }),
      setError
    )
  }
  return (
    <div className="space-y-1.5 py-2" data-bot-askers={source.id}>
      <p className="text-sm font-medium">{source.label}</p>
      <div className="grid gap-1">
        <label className="text-[11px] text-muted-foreground">{t('Your id (the owner)')}</label>
        <Input
          value={owner}
          data-bot-owner={source.id}
          placeholder={t('Your {source} id', { source: source.label })}
          onChange={(e) => setOwner(e.target.value)}
          onBlur={saveOwner}
          onKeyDown={(e) => e.key === 'Enter' && saveOwner()}
        />
        <p className="text-[11px] text-muted-foreground">{source.findId}</p>
      </div>
      {askers.length > 0 ? (
        <ul className="divide-y divide-border/40 text-xs">
          {askers.map((a) => (
            <li key={a.id} className="flex items-center gap-2 py-1">
              <span className="min-w-0 flex-1 truncate">
                {a.name ? `${a.name} · ` : ''}
                <code>{a.id}</code>
              </span>
              <span className="text-muted-foreground">{a.role === 'owner' ? t('Owner') : t('Member')}</span>
              <Button
                size="icon-xs"
                variant="ghost"
                aria-label={t('Remove')}
                onClick={() => run(setBotAskers(bot.id, source.id, askers.filter((x) => x.id !== a.id)), setError)}
              >
                <X />
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="flex gap-2">
        <Input value={newId} placeholder={t('Their id')} className="h-7 text-xs" onChange={(e) => setNewId(e.target.value)} />
        <Input value={newName} placeholder={t('Name (optional)')} className="h-7 text-xs" onChange={(e) => setNewName(e.target.value)} />
        <Button size="xs" variant="outline" disabled={!newId.trim()} onClick={add}>
          <Plus />
          {t('Add')}
        </Button>
      </div>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  )
}

function BotDetail({ bot }: { bot: Bot }) {
  const hosts = useStore((s) => s.hosts)
  const home = useMemo(() => homeOf(bot, allWorkspaces({ hosts })), [bot, hosts])
  const allRequests = useBots((s) => s.accessRequests)
  const requests = useMemo(() => allRequests.filter((r) => r.botId === bot.id), [allRequests, bot.id])
  const [editing, setEditing] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [alsoFolder, setAlsoFolder] = useState(false)
  const [error, setError] = useState<string | null>(null)
  return (
    <div className="space-y-4" data-bot-detail={bot.handle}>
      <div className="flex items-center gap-3">
        <Button size="icon-xs" variant="ghost" aria-label={t('All bots')} onClick={() => selectBot(null)}>
          <ArrowLeft />
        </Button>
        <BotAvatar bot={bot} size={36} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">
            {bot.name} <span className="font-normal text-muted-foreground">@{bot.handle}</span>
          </p>
          <p className="truncate text-xs text-muted-foreground">{home ?? t('Its home folder is not a project on this computer any more.')}</p>
        </div>
        <Button size="sm" variant="outline" data-bot-edit onClick={() => setEditing(true)}>
          <Pencil />
          {t('Edit')}
        </Button>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" data-bot-open-soul disabled={!home} onClick={() => openHomeFile(bot, 'SOUL.md')}>
          <FileText />
          {t('Open SOUL.md')}
        </Button>
        <Button size="sm" variant="outline" data-bot-open-memory disabled={!home} onClick={() => openHomeFile(bot, 'MEMORY.md')}>
          <FileText />
          {t('Open MEMORY.md')}
        </Button>
        <Button size="sm" variant="outline" disabled={!home} onClick={() => home && openWorkspaceIn('explorer', LOCAL_HOST, home)}>
          <FolderOpen />
          {t('Open home folder')}
        </Button>
      </div>
      <div className="space-y-1 rounded-lg border border-border/60 bg-background/40 px-4 py-3">
        <SettingsSubsectionHeader
          title={t('Who can ask')}
          description={t('Only you and the people listed here can start or steer this bot from a source. Others are told to ask you, and may send an access request.')}
        />
        <div className="divide-y divide-border/40">
          {ASK_SOURCES.map((source) => (
            <AskersEditor key={`${bot.id}:${source.id}`} bot={bot} source={source} />
          ))}
        </div>
        {requests.length > 0 ? (
          <div className="border-t border-border/40 pt-2">
            <p className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">{t('Access requests')}</p>
            {requests.map((r) => (
              <AccessRequestRow key={r.id} request={r} bot={bot} />
            ))}
          </div>
        ) : null}
      </div>
      <div className="space-y-1 rounded-lg border border-border/60 bg-background/40 px-4 py-3">
        <SettingsSubsectionHeader
          title={t('Schedules and triggers')}
          description={t('A bot’s schedules and event triggers come in a later Zomfy version; until then use Automations in its home folder.')}
        />
      </div>
      <div className="space-y-3 rounded-lg border border-border/60 bg-background/40 px-4 py-3">
        <label className="flex items-center justify-between gap-3 text-sm">
          <span className="grid gap-0.5">
            {t('Paused')}
            <span className="text-xs text-muted-foreground">{t('A paused bot takes no new requests; turns already running go on.')}</span>
          </span>
          <Switch checked={bot.paused} data-bot-pause onCheckedChange={(paused) => run(pauseBot(bot.id, paused), setError)} />
        </label>
        {confirmDelete ? (
          <div className="space-y-2 rounded-md border border-destructive/40 p-3" data-bot-delete-confirm>
            <p className="text-sm">{t('Delete {name}? Its chats stay.', { name: bot.name })}</p>
            <label className="flex items-center gap-2 text-xs">
              <Checkbox checked={alsoFolder} onCheckedChange={(v) => setAlsoFolder(v === true)} />
              {t('Also delete the folder (only a folder Zomfy made under ~/zomfy/bots)')}
            </label>
            <div className="flex gap-2">
              <Button size="sm" variant="destructive" data-bot-delete-yes onClick={() => run(deleteBot(bot.id, alsoFolder), setError)}>
                {t('Delete')}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>
                {t('Cancel')}
              </Button>
            </div>
          </div>
        ) : (
          <Button size="sm" variant="outline" className="text-destructive" data-bot-delete onClick={() => setConfirmDelete(true)}>
            <Trash2 />
            {t('Delete bot')}
          </Button>
        )}
        {error ? <p className="text-xs text-destructive">{error}</p> : null}
      </div>
      <BotEditorDialog open={editing} existing={bot} onOpenChange={setEditing} />
    </div>
  )
}

function BotsList() {
  const bots = useBots((s) => s.bots)
  const requests = useBots((s) => s.accessRequests)
  const [creating, setCreating] = useState(false)
  return (
    <div className="space-y-2 rounded-lg border border-border/60 bg-background/40 px-4 py-3" data-bots-list>
      <div className="flex items-start justify-between gap-2">
        <SettingsSubsectionHeader title={t('Bots')} description={t('Each bot lives in a home folder on this computer and runs on its agent’s sign-in here.')} />
        <Button size="sm" data-bot-create onClick={() => setCreating(true)}>
          <Plus />
          {t('Create bot')}
        </Button>
      </div>
      {bots && bots.length === 0 ? <p className="py-2 text-sm text-muted-foreground">{t('No bots yet.')}</p> : null}
      <div className="divide-y divide-border/40">
        {(bots ?? []).map((bot) => {
          const pending = requests.filter((r) => r.botId === bot.id).length
          return (
            <button
              key={bot.id}
              type="button"
              data-bot-settings-row={bot.handle}
              onClick={() => selectBot(bot.id)}
              className="flex w-full items-center gap-3 py-2 text-left hover:bg-accent/30"
            >
              <BotAvatar bot={bot} size={24} />
              <span className="min-w-0 flex-1">
                <span className="block text-sm">
                  {bot.name} <span className="text-xs text-muted-foreground">@{bot.handle}</span>
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  {bot.agent}
                  {bot.paused ? ` · ${t('Paused')}` : ''}
                  {bot.isDefault ? ` · ${t('Default')}` : ''}
                  {pending ? ` · ${t('{n} access requests', { n: pending })}` : ''}
                </span>
              </span>
            </button>
          )
        })}
      </div>
      <BotEditorDialog open={creating} existing={null} onOpenChange={setCreating} onSaved={(bot) => selectBot(bot.id)} />
    </div>
  )
}

export function BotsPane() {
  const status = useBots((s) => s.connector)
  const selected = useBots((s) => (s.selectedId ? s.bots?.find((b) => b.id === s.selectedId) : undefined))
  if (selected) return <BotDetail bot={selected} />
  return (
    <div className="space-y-4">
      <RelaySection status={status} />
      <SourcesSection status={status} />
      <BotsList />
    </div>
  )
}
