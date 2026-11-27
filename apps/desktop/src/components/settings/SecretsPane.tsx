import { useCallback, useEffect, useState } from 'react'
import { Check, KeyRound, RefreshCw, Trash2 } from 'lucide-react'
import { HARNESS_METHODS, type ChatAgentId, type ChatAgentInfo, type Project, type SecretInfo, type SecretSaveParams } from '@zomfy/protocol'
import { harnessRequest } from '@/daemon-connection'
import type { HostEntry } from '@/session-store'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { TuiAgentIcon } from '@/components/terminal/TuiAgentIcon'
import { projectLabel } from '@/components/sidebar/workspace-visibility'
import { useSaveState } from '@/lib/use-save-state'
import { cn } from '@/lib/utils'
import { HostAgentPicker, useHostAgentPick } from './HostAgentPicker'
import { SearchableSetting } from './SettingsSection'
import { t } from '@/i18n/i18n'

// Secrets agents get as environment variables (docs/specs/agent-secrets.md) and Reload environment
// (docs/specs/live-environment.md), for the host and agent picked at the top
// (docs/specs/settings-host-agent-scope.md). A value goes to the host once and never comes back:
// a row shows •••••••• and typing there replaces it.

type HostSecrets = { kind: 'loading' } | { kind: 'ready'; secrets: SecretInfo[] } | { kind: 'failed'; reason: string }

const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

/** Whether the agent gets the secret: it is for every agent, or for this one among others. */
export function secretAppliesTo(secret: Pick<SecretInfo, 'agents'>, agent: ChatAgentId): boolean {
  return secret.agents.length === 0 || secret.agents.includes(agent)
}

export function SecretsPane() {
  const pick = useHostAgentPick()
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <HostAgentPicker pick={pick} />
        {pick.host ? <ReloadEnvironmentButton host={pick.host} /> : null}
      </div>
      {pick.host && pick.agent ? <HostAgentSecrets key={pick.host.id} host={pick.host} agent={pick.agent} /> : null}
    </div>
  )
}

function HostAgentSecrets({ host, agent }: { host: HostEntry; agent: ChatAgentInfo }) {
  const [state, setState] = useState<HostSecrets>({ kind: 'loading' })
  const load = useCallback(() => {
    harnessRequest(HARNESS_METHODS.secretsList, {}, host.id).then(
      (secrets) => setState({ kind: 'ready', secrets }),
      (error: unknown) => setState({ kind: 'failed', reason: message(error) })
    )
  }, [host.id])
  useEffect(load, [load])
  const secrets = state.kind === 'ready' ? state.secrets.filter((s) => secretAppliesTo(s, agent.id)) : []
  const save = async (params: SecretSaveParams) => setState({ kind: 'ready', secrets: await harnessRequest(HARNESS_METHODS.secretSave, params, host.id) })
  const remove = async (id: string) => setState({ kind: 'ready', secrets: await harnessRequest(HARNESS_METHODS.secretDelete, { id }, host.id) })
  return (
    <SearchableSetting entry={{ title: t('Secrets'), keywords: ['secret', 'api key', 'token', 'credential', 'environment', 'XAI_API_KEY', 'OPENAI_API_KEY'] }}>
      <div className="divide-y divide-border/40 rounded-lg border border-border/60 bg-background/40" data-setting-row data-secrets-host={host.id} data-secrets-agent={agent.id}>
        {state.kind === 'failed' ? <p className="px-3 py-2 text-xs text-destructive">{state.reason}</p> : null}
        {secrets.map((secret) => (
          <SecretRow key={secret.id} host={host} agent={agent} secret={secret} onSave={save} onDelete={() => remove(secret.id)} />
        ))}
        {state.kind === 'ready' ? <SecretRow key={`new:${state.secrets.length}`} host={host} agent={agent} secret={null} onSave={save} /> : null}
      </div>
    </SearchableSetting>
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

/** Toggles where none picked means all: the first pick narrows to it, removing the last widens again. */
function toggle<T>(picked: T[], item: T): T[] {
  return picked.includes(item) ? picked.filter((p) => p !== item) : [...picked, item]
}

interface Draft {
  name: string
  value: string
  /** For the picked agent only (the secret's own agents kept), or for every agent. */
  only: boolean
  projectIds: string[]
}

/**
 * A secret of the picked pair, editable in place, or (`secret` null) the row that adds one. Save
 * shows only while the row differs from what is saved (docs/specs/save-buttons.md); no Cancel.
 */
function SecretRow({
  host,
  agent,
  secret,
  onSave,
  onDelete
}: {
  host: HostEntry
  agent: ChatAgentInfo
  secret: SecretInfo | null
  onSave: (params: SecretSaveParams) => Promise<void>
  onDelete?: () => Promise<void>
}) {
  const projects: Project[] = host.harness?.projects ?? []
  const saved: Draft = { name: secret?.name ?? '', value: '', only: secret ? secret.agents.length > 0 : true, projectIds: secret?.projectIds ?? [] }
  const [draft, setDraft] = useState<Draft>(saved)
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const complete = draft.name.trim() !== '' && (secret !== null || draft.value.trim() !== '')
  const { dirty, saving, save } = useSaveState(saved, draft, async () => {
    if (!complete) return false
    setError(null)
    try {
      await onSave({
        ...(secret ? { id: secret.id } : {}),
        name: draft.name.trim(),
        ...(draft.value.trim() ? { value: draft.value } : {}),
        // Kept as they were while still "only": a secret for several agents stays so.
        agents: draft.only ? (secret && secret.agents.length > 0 ? secret.agents : [agent.id]) : [],
        projectIds: draft.projectIds
      })
      setDraft((d) => ({ ...d, value: '' }))
    } catch (e) {
      setError(message(e))
      return false
    }
  })
  const offerSave = dirty && complete
  const onEnter = (event: React.KeyboardEvent) => {
    if (event.key === 'Enter' && offerSave) void save()
  }
  return (
    <div className="space-y-1.5 px-3 py-2" data-secret={secret?.name ?? 'new'}>
      <div className="flex min-w-0 items-center gap-2">
        <KeyRound className={cn('size-3.5 shrink-0', secret ? 'text-muted-foreground' : 'text-muted-foreground/50')} />
        {secret ? (
          <span className="w-56 shrink-0 truncate font-mono text-sm font-medium">{secret.name}</span>
        ) : (
          <Input
            value={draft.name}
            onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
            onKeyDown={onEnter}
            aria-label={t('Variable name')}
            placeholder="XAI_API_KEY"
            spellCheck={false}
            className="h-7 w-56 shrink-0 font-mono text-xs"
            data-secret-name
          />
        )}
        <Input
          type="password"
          autoComplete="off"
          value={draft.value}
          onChange={(e) => setDraft((d) => ({ ...d, value: e.target.value }))}
          onKeyDown={onEnter}
          aria-label={secret ? t('Value for {name}', { name: secret.name }) : t('Value')}
          placeholder={secret ? '••••••••' : t('Value')}
          spellCheck={false}
          className="h-7 min-w-0 flex-1 text-xs"
          data-secret-value
        />
        {offerSave || saving ? (
          <Button type="button" size="xs" disabled={saving} onClick={() => void save()} data-secret-save>
            {saving ? t('Saving…') : t('Save')}
          </Button>
        ) : null}
        {secret && onDelete ? (
          confirming ? (
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
          )
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-1 pl-5.5">
        <button
          type="button"
          aria-pressed={draft.only}
          title={draft.only ? t('{agent} only', { agent: agent.label }) : t('Every agent')}
          onClick={() => setDraft((d) => ({ ...d, only: !d.only }))}
          className={cn(
            'flex size-6 items-center justify-center rounded-md outline-none transition focus-visible:ring-[3px] focus-visible:ring-ring/50',
            draft.only ? 'bg-primary/15 ring-1 ring-primary/50' : 'opacity-40 hover:bg-muted hover:opacity-100'
          )}
          data-secret-agent-only={draft.only || undefined}
        >
          <TuiAgentIcon agent={agent.id} size={14} />
        </button>
        {projects.length > 0 ? <span className="mx-1 h-4 w-px bg-border" aria-hidden /> : null}
        {projects.map((project) => {
          const picked = draft.projectIds.includes(project.id)
          return (
            <button
              key={project.id}
              type="button"
              aria-pressed={picked}
              onClick={() => setDraft((d) => ({ ...d, projectIds: toggle(d.projectIds, project.id) }))}
              className={cn(
                'rounded-full px-2 py-0.5 text-[11px] outline-none transition focus-visible:ring-[3px] focus-visible:ring-ring/50',
                picked ? 'bg-primary/15 text-foreground ring-1 ring-primary/50' : 'bg-muted text-muted-foreground hover:text-foreground',
                !picked && draft.projectIds.length > 0 && 'opacity-50'
              )}
              data-secret-project={project.id}
            >
              {projectLabel({ ...project, hostId: host.id })}
            </button>
          )
        })}
      </div>
      {error ? <p className="pl-5.5 text-xs text-destructive">{error}</p> : null}
    </div>
  )
}
