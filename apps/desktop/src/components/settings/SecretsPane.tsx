import { useCallback, useEffect, useState } from 'react'
import { Check, KeyRound, Plus, RefreshCw, Trash2, TriangleAlert, Variable, Waypoints } from 'lucide-react'
import { HARNESS_METHODS, type ChatAgentId, type Project, type SecretExposure, type SecretInfo, type SecretSaveParams } from '@zomfy/protocol'
import { harnessRequest } from '@/daemon-connection'
import { useStore, type HostEntry } from '@/session-store'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { TuiAgentIcon } from '@/components/terminal/TuiAgentIcon'
import { projectLabel } from '@/components/sidebar/workspace-visibility'
import { useChatAgents } from '@/lib/chat-agents'
import { cn } from '@/lib/utils'
import { sortedHosts } from './HostsPane'
import { SettingsSegmentedControl } from './settings-form-controls'
import { SearchableSetting } from './SettingsSection'
import { t } from '@/i18n/i18n'

// Secrets agents can use but not see (docs/specs/agent-secrets.md) and Reload environment
// (docs/specs/live-environment.md), one block per connected host. A value goes to the host once and
// never comes back: rows show •••••••• and offer Replace or Delete.

type HostSecrets = { kind: 'loading' } | { kind: 'ready'; secrets: SecretInfo[] } | { kind: 'failed'; reason: string }

const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

export function SecretsPane() {
  const hosts = useStore((s) => s.hosts)
  return (
    <div className="space-y-8">
      {sortedHosts(hosts)
        .filter((host) => host.connection.kind === 'connected')
        .map((host) => (
          <HostSecretsBlock key={host.id} host={host} />
        ))}
    </div>
  )
}

function HostSecretsBlock({ host }: { host: HostEntry }) {
  const [state, setState] = useState<HostSecrets>({ kind: 'loading' })
  const [adding, setAdding] = useState(false)
  const load = useCallback(() => {
    harnessRequest(HARNESS_METHODS.secretsList, {}, host.id).then(
      (secrets) => setState({ kind: 'ready', secrets }),
      (error: unknown) => setState({ kind: 'failed', reason: message(error) })
    )
  }, [host.id])
  useEffect(load, [load])
  const secrets = state.kind === 'ready' ? state.secrets : []
  const save = async (params: SecretSaveParams) => setState({ kind: 'ready', secrets: await harnessRequest(HARNESS_METHODS.secretSave, params, host.id) })
  const remove = async (id: string) => setState({ kind: 'ready', secrets: await harnessRequest(HARNESS_METHODS.secretDelete, { id }, host.id) })
  return (
    <div className="space-y-2" data-secrets-host={host.id}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-semibold">{host.label}</span>
        <ReloadEnvironmentButton host={host} />
      </div>
      <SearchableSetting entry={{ title: t('Secrets'), keywords: ['secret', 'api key', 'token', 'credential', 'tunnel', 'environment', 'XAI_API_KEY', 'OPENAI_API_KEY'] }}>
        <div className="divide-y divide-border/40 rounded-lg border border-border/60 bg-background/40" data-setting-row>
          {state.kind === 'failed' ? <p className="px-3 py-2 text-xs text-destructive">{state.reason}</p> : null}
          {secrets.map((secret) => (
            <SecretRow key={secret.id} host={host} secret={secret} onSave={save} onDelete={() => remove(secret.id)} />
          ))}
          {adding ? (
            <SecretForm host={host} secret={null} onSave={async (params) => (await save(params), setAdding(false))} onCancel={() => setAdding(false)} />
          ) : (
            <button
              type="button"
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
              onClick={() => setAdding(true)}
              data-secret-add
            >
              <Plus className="size-3.5" />
              {t('Add a secret')}
            </button>
          )}
        </div>
      </SearchableSetting>
    </div>
  )
}

/** Re-reads the person's environment on the host; shows how many variables changed, for a moment. */
function ReloadEnvironmentButton({ host }: { host: HostEntry }) {
  const [busy, setBusy] = useState(false)
  const [changed, setChanged] = useState<string[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (!changed) return
    const timer = setTimeout(() => setChanged(null), 4_000)
    return () => clearTimeout(timer)
  }, [changed])
  const reload = () => {
    setBusy(true)
    setError(null)
    harnessRequest(HARNESS_METHODS.environmentReload, {}, host.id)
      .then((result) => setChanged(result.changed), (e: unknown) => setError(message(e)))
      .finally(() => setBusy(false))
  }
  return (
    <SearchableSetting entry={{ title: t('Reload environment'), keywords: ['environment', 'reload', 'PATH', 'setx', 'variable', 'profile'] }}>
      <div className="flex items-center gap-2" data-setting-row>
        {error ? <span className="text-xs text-destructive">{error}</span> : null}
        {changed ? (
          changed.length === 0 ? (
            <Check className="size-3.5 text-status-success" aria-label={t('Nothing changed')} data-env-reload-result="0" />
          ) : (
            <span
              className="rounded-full bg-primary/15 px-1.5 font-mono text-xs text-primary tabular-nums"
              title={changed.join('\n')}
              data-env-reload-result={changed.length}
            >
              {changed.length}
            </span>
          )
        ) : null}
        <Button type="button" variant="ghost" size="xs" disabled={busy} onClick={reload} data-env-reload>
          <RefreshCw className={cn('size-3', busy && 'animate-spin')} />
          {t('Reload environment')}
        </Button>
      </div>
    </SearchableSetting>
  )
}

function ExposureMark({ exposure, className }: { exposure: SecretExposure; className?: string }) {
  return exposure === 'tunnel' ? (
    <Waypoints className={cn('size-3.5 shrink-0 text-status-success', className)} aria-label={t('Tunnel')} />
  ) : (
    <Variable className={cn('size-3.5 shrink-0 text-status-warning', className)} aria-label={t('Environment variable')} />
  )
}

function useHostProjects(host: HostEntry): Project[] {
  return host.harness?.projects ?? []
}

function SecretRow({
  host,
  secret,
  onSave,
  onDelete
}: {
  host: HostEntry
  secret: SecretInfo
  onSave: (params: SecretSaveParams) => Promise<void>
  onDelete: () => Promise<void>
}) {
  const [editing, setEditing] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const projects = useHostProjects(host).filter((p) => secret.projectIds.includes(p.id))
  if (editing) {
    return <SecretForm host={host} secret={secret} onSave={async (params) => (await onSave(params), setEditing(false))} onCancel={() => setEditing(false)} />
  }
  const upstreamHost = secret.upstream ? safeHost(secret.upstream) : null
  return (
    <div className="px-3 py-2" data-secret={secret.name}>
      <div className="flex min-w-0 items-center gap-2">
        <KeyRound className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="font-mono text-sm font-medium">{secret.name}</span>
        <ExposureMark exposure={secret.exposure} />
        {upstreamHost ? <span className="truncate font-mono text-xs text-muted-foreground">{upstreamHost}</span> : null}
        <span className="flex items-center gap-1">
          {secret.agents.map((agent) => (
            <TuiAgentIcon key={agent} agent={agent} size={13} />
          ))}
        </span>
        {projects.map((p) => (
          <span key={p.id} className="truncate rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
            {projectLabel({ ...p, hostId: host.id })}
          </span>
        ))}
        <span className="flex-1" />
        <span className="font-mono text-xs tracking-widest text-muted-foreground" aria-label={t('Saved value')}>
          ••••••••
        </span>
        <Button type="button" variant="outline" size="xs" onClick={() => setEditing(true)} data-secret-replace>
          {t('Replace value')}
        </Button>
        {confirming ? (
          <Button
            type="button"
            variant="destructive"
            size="xs"
            onClick={() => void onDelete().catch((e: unknown) => setError(message(e)))}
            onBlur={() => setConfirming(false)}
            autoFocus
            data-secret-delete-confirm
          >
            {t('Delete')}
          </Button>
        ) : (
          <Button type="button" variant="ghost" size="icon-xs" aria-label={t('Delete {name}', { name: secret.name })} onClick={() => setConfirming(true)} data-secret-delete>
            <Trash2 />
          </Button>
        )}
      </div>
      {error ? <p className="pt-1 text-xs text-destructive">{error}</p> : null}
    </div>
  )
}

function safeHost(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

/** Toggles where none picked means all: the first pick narrows to it, removing the last widens again. */
function toggle<T>(picked: T[], item: T): T[] {
  return picked.includes(item) ? picked.filter((p) => p !== item) : [...picked, item]
}

function SecretForm({
  host,
  secret,
  onSave,
  onCancel
}: {
  host: HostEntry
  secret: SecretInfo | null
  onSave: (params: SecretSaveParams) => Promise<void>
  onCancel: () => void
}) {
  const agents = useChatAgents(host.id).agents.filter((a) => a.status !== 'missing')
  const projects = useHostProjects(host)
  const [name, setName] = useState(secret?.name ?? '')
  const [value, setValue] = useState('')
  const [exposure, setExposure] = useState<SecretExposure>(secret?.exposure ?? 'tunnel')
  const [upstream, setUpstream] = useState(secret?.upstream ?? '')
  const [baseUrlVariable, setBaseUrlVariable] = useState(secret?.baseUrlVariable ?? '')
  const [pickedAgents, setPickedAgents] = useState<ChatAgentId[]>(secret?.agents ?? [])
  const [pickedProjects, setPickedProjects] = useState<string[]>(secret?.projectIds ?? [])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const complete = name.trim() !== '' && (secret !== null || value.trim() !== '') && (exposure === 'env' || upstream.trim() !== '')
  const sameList = <T,>(a: T[], b: T[]) => a.length === b.length && a.every((x) => b.includes(x))
  const dirty =
    !secret ||
    value.trim() !== '' ||
    name.trim() !== secret.name ||
    exposure !== secret.exposure ||
    (exposure === 'tunnel' && (upstream.trim() !== (secret.upstream ?? '') || baseUrlVariable.trim() !== (secret.baseUrlVariable ?? ''))) ||
    !sameList(pickedAgents, secret.agents) ||
    !sameList(pickedProjects, secret.projectIds)
  const save = () => {
    if (!complete || !dirty || saving) return
    setSaving(true)
    setError(null)
    onSave({
      ...(secret ? { id: secret.id } : {}),
      name: name.trim(),
      ...(value.trim() ? { value } : {}),
      exposure,
      upstream: exposure === 'tunnel' ? upstream.trim() : null,
      baseUrlVariable: exposure === 'tunnel' ? baseUrlVariable.trim() || null : null,
      agents: pickedAgents,
      projectIds: pickedProjects
    })
      .catch((e: unknown) => setError(message(e)))
      .finally(() => setSaving(false))
  }
  const onEnter = (event: React.KeyboardEvent) => {
    if (event.key === 'Enter') save()
    if (event.key === 'Escape') onCancel()
  }
  return (
    <div className="space-y-2.5 bg-muted/30 px-3 py-3" data-secret-form={secret?.name ?? 'new'}>
      <div className="flex items-center gap-2">
        <KeyRound className="size-3.5 shrink-0 text-muted-foreground" />
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={onEnter}
          aria-label={t('Variable name')}
          placeholder="XAI_API_KEY"
          spellCheck={false}
          autoFocus={!secret}
          className="h-7 w-56 font-mono text-xs"
          data-secret-name
        />
        <Input
          type="password"
          autoComplete="off"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onEnter}
          aria-label={t('Value')}
          placeholder={secret ? '••••••••' : t('Value')}
          spellCheck={false}
          autoFocus={!!secret}
          className="h-7 flex-1 text-xs"
          data-secret-value
        />
      </div>
      <div className="flex flex-wrap items-center gap-2 pl-5.5">
        <SettingsSegmentedControl
          size="sm"
          ariaLabel={t('Exposure')}
          value={exposure}
          onChange={setExposure}
          options={[
            {
              value: 'tunnel',
              label: (
                <span className="flex items-center gap-1.5">
                  <ExposureMark exposure="tunnel" className="size-3" />
                  {t('Tunnel')}
                </span>
              )
            },
            {
              value: 'env',
              label: (
                <span className="flex items-center gap-1.5">
                  <ExposureMark exposure="env" className="size-3" />
                  {t('Environment variable')}
                </span>
              )
            }
          ]}
        />
        {exposure === 'tunnel' ? (
          <>
            <Input
              value={upstream}
              onChange={(e) => setUpstream(e.target.value)}
              onKeyDown={onEnter}
              aria-label={t('Upstream URL')}
              placeholder="https://api.x.ai/v1"
              spellCheck={false}
              className="h-7 w-56 font-mono text-xs"
              data-secret-upstream
            />
            <Input
              value={baseUrlVariable}
              onChange={(e) => setBaseUrlVariable(e.target.value)}
              onKeyDown={onEnter}
              aria-label={t('Base URL variable')}
              placeholder="XAI_BASE_URL"
              spellCheck={false}
              className="h-7 w-40 font-mono text-xs"
              data-secret-base-url-variable
            />
          </>
        ) : (
          <span className="flex items-center gap-1.5 text-xs text-status-warning" data-secret-env-warning>
            <TriangleAlert className="size-3.5 shrink-0" />
            {t('Programs the agent runs can print this value.')}
          </span>
        )}
      </div>
      {agents.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1 pl-5.5" role="group" aria-label={t('Agents')}>
          {agents.map((agent) => {
            const on = pickedAgents.length === 0 || pickedAgents.includes(agent.id)
            return (
              <button
                key={agent.id}
                type="button"
                aria-pressed={pickedAgents.includes(agent.id)}
                title={agent.label}
                onClick={() => setPickedAgents((picked) => toggle(picked, agent.id))}
                className={cn(
                  'flex size-6 items-center justify-center rounded-md outline-none transition focus-visible:ring-[3px] focus-visible:ring-ring/50',
                  pickedAgents.includes(agent.id) ? 'bg-primary/15 ring-1 ring-primary/50' : 'hover:bg-muted',
                  on ? 'opacity-100' : 'opacity-35'
                )}
                data-secret-agent={agent.id}
              >
                <TuiAgentIcon agent={agent.id} size={14} />
              </button>
            )
          })}
        </div>
      ) : null}
      {projects.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1 pl-5.5" role="group" aria-label={t('Projects')}>
          {projects.map((project) => {
            const picked = pickedProjects.includes(project.id)
            return (
              <button
                key={project.id}
                type="button"
                aria-pressed={picked}
                onClick={() => setPickedProjects((list) => toggle(list, project.id))}
                className={cn(
                  'rounded-full px-2 py-0.5 text-[11px] outline-none transition focus-visible:ring-[3px] focus-visible:ring-ring/50',
                  picked ? 'bg-primary/15 text-foreground ring-1 ring-primary/50' : 'bg-muted text-muted-foreground hover:text-foreground',
                  !picked && pickedProjects.length > 0 && 'opacity-50'
                )}
                data-secret-project={project.id}
              >
                {projectLabel({ ...project, hostId: host.id })}
              </button>
            )
          })}
        </div>
      ) : null}
      <div className="flex items-center gap-2 pl-5.5">
        {error ? <span className="text-xs text-destructive">{error}</span> : null}
        <span className="flex-1" />
        <Button type="button" variant="ghost" size="xs" onClick={onCancel}>
          {t('Cancel')}
        </Button>
        <Button type="button" size="xs" disabled={!complete || !dirty || saving} onClick={save} data-secret-save>
          {saving ? t('Saving…') : t('Save')}
        </Button>
      </div>
    </div>
  )
}
