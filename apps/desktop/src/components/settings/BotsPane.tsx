import { useMemo, useState } from 'react'
import { ArrowLeft, CalendarClock, FileText, FolderOpen, Pencil, Plus, Search, Trash2, X, Zap } from 'lucide-react'
import { HARNESS_METHODS, type Bot, type BotAsker, type BotSource, type ConnectorStatus } from '@zomfy/protocol'
import { harnessRequest } from '@/daemon-connection'
import { allWorkspaces, LOCAL_HOST, openEditorTab, selectWorkspace, useStore } from '@/session-store'
import {
  botAction,
  deleteBot,
  pauseBot,
  selectBot,
  setBotAskers,
  updateBot,
  useBots
} from '@/stores/bots-store'
import { closeSettings, openSettings } from '@/stores/app-overlay-store'
import { openWorkspaceIn } from '@/components/sidebar/WorkspaceMenu'
import { BotAvatar } from '@/components/bots/BotAvatar'
import { BotEditorDialog } from '@/components/bots/BotEditorDialog'
import { AccessRequestRow } from '@/components/bots/AccessRequestRow'
import { AutomationEditorDialog } from '@/components/automations/AutomationEditorDialog'
import { triggerLabel } from '@/components/automations/AutomationsPage'
import { allAutomations, useAutomationState, useLoadAutomations, type HostedAutomation } from '@/stores/automation-store'
import { automationsForBot, foundMembers } from '@/lib/bot-automation'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { SettingsSubsectionHeader } from './settings-form-controls'
import { RelayStateDot, relayStateLabel } from './RelayPane'
import { t } from '@/i18n/i18n'

// Settings → Bots (docs/specs/bots/desktop.md#settings--bots): the relay's state, with its settings in
// Settings → Zomfy Relay (docs/specs/relay-settings.md), and each bot: its files, Who can ask, pause and delete.

const ASK_SOURCES: { id: BotSource; label: string; findId: string; find?: boolean }[] = [
  {
    id: 'discord',
    label: 'Discord',
    findId: t('In Discord, turn on Developer Mode (Settings → Advanced), then right-click your name and choose Copy User ID.')
  },
  { id: 'slack', label: 'Slack', findId: t('In Slack, open your profile, choose ⋮ and Copy member ID.') },
  { id: 'github', label: 'GitHub', findId: t('Your GitHub login, as in github.com/<login>.') },
  { id: 'linear', label: 'Linear', findId: t('In Linear, open your profile; the id is in the URL after /profiles/.'), find: true }
]

function run(task: Promise<unknown>, setError: (error: string | null) => void): void {
  setError(null)
  void task.catch((e) => setError(e instanceof Error ? e.message : String(e)))
}

/** The relay's one-line state here; its settings are in Settings → Zomfy Relay (docs/specs/relay-settings.md). */
function RelaySummary({ status }: { status: ConnectorStatus | null }) {
  const state = status?.state ?? 'unpaired'
  const sources = status?.sources ?? []
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border/60 bg-background/40 px-4 py-3" data-bots-relay>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2 text-sm font-medium" data-relay-state={state}>
          <RelayStateDot state={state} />
          {t('Zomfy Relay')} · {relayStateLabel(state)}
        </span>
        <span className="block truncate text-xs text-muted-foreground">
          {state === 'unpaired'
            ? t('Bots answer in Zomfy without it; Discord, Slack, GitHub, Linear and webhooks reach them through it.')
            : sources.length > 0
              ? t('Sources: {sources}', { sources: sources.join(', ') })
              : t('No sources configured on the relay yet.')}
        </span>
      </span>
      <Button size="sm" variant="outline" data-bots-relay-settings onClick={() => openSettings('relay')}>
        {t('Relay settings')}
      </Button>
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
  const addMember = (id: string, name: string, then?: () => void) => {
    if (askers.some((a) => a.id === id)) return
    const asker: BotAsker = { id, role: 'member', ...(name ? { name } : {}) }
    run(setBotAskers(bot.id, source.id, [...askers, asker]).then(then), setError)
  }
  const add = () => {
    const id = newId.trim()
    if (!id) return
    addMember(id, newName.trim(), () => {
      setNewId('')
      setNewName('')
    })
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
      {source.find ? <MemberSearch source={source.id} onAdd={(member) => addMember(member.id, member.name)} /> : null}
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

/** Finds people in a source through the relay (`find`), to add one as a member asker. */
function MemberSearch({ source, onAdd }: { source: BotSource; onAdd: (member: { id: string; name: string }) => void }) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [found, setFound] = useState<{ id: string; name: string; handle?: string }[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const search = () => {
    const q = text.trim()
    if (!q || busy) return
    setBusy(true)
    setError(null)
    botAction('find', { source, text: q })
      .then((result) => setFound(foundMembers(result)))
      .catch((e: unknown) => {
        setFound(null)
        setError(e instanceof Error ? e.message : String(e))
      })
      .finally(() => setBusy(false))
  }
  return (
    <div className="space-y-1" data-bot-member-search={source}>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          search()
        }}
      >
        <Input value={text} placeholder={t('Find a member by name')} className="h-7 text-xs" onChange={(e) => setText(e.target.value)} />
        <Button type="submit" size="xs" variant="outline" disabled={!text.trim() || busy}>
          <Search />
          {busy ? t('Finding…') : t('Find')}
        </Button>
      </form>
      {found && found.length === 0 ? <p className="text-[11px] text-muted-foreground">{t('Nobody found.')}</p> : null}
      {found && found.length > 0 ? (
        <ul className="divide-y divide-border/40 text-xs">
          {found.map((m) => (
            <li key={m.id} className="flex items-center gap-2 py-1">
              <span className="min-w-0 flex-1 truncate">
                {m.name}
                {m.handle ? <span className="text-muted-foreground"> · {m.handle}</span> : null}
              </span>
              <Button
                size="xs"
                variant="ghost"
                onClick={() => {
                  onAdd({ id: m.id, name: m.name })
                  setFound((list) => list?.filter((x) => x.id !== m.id) ?? null)
                }}
              >
                <Plus />
                {t('Add')}
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  )
}

/** The bot's schedules and source triggers, with New schedule / New trigger. */
function BotAutomations({ bot }: { bot: Bot }) {
  useLoadAutomations()
  const byHost = useAutomationState((s) => s.byHost)
  const automations = useMemo(() => automationsForBot(allAutomations(byHost).filter((a) => a.hostId === LOCAL_HOST), bot.id), [byHost, bot.id])
  const [editor, setEditor] = useState<{ existing: HostedAutomation | null; mode: 'schedule' | 'trigger' } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const names = useMemo(() => new Map<string, string>(), [])
  return (
    <div className="space-y-2 rounded-lg border border-border/60 bg-background/40 px-4 py-3" data-bot-automations>
      <div className="flex items-start justify-between gap-2">
        <SettingsSubsectionHeader
          title={t('Schedules and triggers')}
          description={t('Runs in the bot’s home with its persona, on this computer while Zomfy runs. A trigger needs the relay.')}
        />
        <div className="flex shrink-0 gap-2">
          <Button size="sm" variant="outline" data-bot-new-schedule onClick={() => setEditor({ existing: null, mode: 'schedule' })}>
            <CalendarClock />
            {t('New schedule')}
          </Button>
          <Button size="sm" variant="outline" data-bot-new-trigger onClick={() => setEditor({ existing: null, mode: 'trigger' })}>
            <Zap />
            {t('New trigger')}
          </Button>
        </div>
      </div>
      {automations.length === 0 ? <p className="py-1 text-xs text-muted-foreground">{t('None yet.')}</p> : null}
      <ul className="divide-y divide-border/40">
        {automations.map((a) => (
          <li key={a.id} className="flex items-center gap-3 py-1.5" data-bot-automation={a.id}>
            <button
              type="button"
              className="min-w-0 flex-1 text-left hover:underline"
              onClick={() => setEditor({ existing: a, mode: a.trigger.kind === 'schedule' ? 'schedule' : 'trigger' })}
            >
              <span className="block truncate text-sm">{a.name || t('Untitled')}</span>
              <span className="block truncate text-xs text-muted-foreground">{triggerLabel(a.trigger, names)}</span>
            </button>
            <Switch
              checked={a.enabled}
              aria-label={t('Enabled')}
              onCheckedChange={(enabled) => run(harnessRequest(HARNESS_METHODS.automationUpdate, { id: a.id, patch: { enabled } }, a.hostId), setError)}
            />
          </li>
        ))}
      </ul>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      <AutomationEditorDialog
        open={editor !== null}
        existing={editor?.existing ?? null}
        defaultWorkspace={null}
        botPreset={editor && !editor.existing ? { bot, mode: editor.mode } : null}
        onOpenChange={(open) => !open && setEditor(null)}
      />
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
      <BotAutomations bot={bot} />
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
                  {bot.manager ? ` · ${t('Master')}` : ''}
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
      <RelaySummary status={status} />
      <BotsList />
    </div>
  )
}
