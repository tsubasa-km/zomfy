import { useState, type ReactNode } from 'react'
import { ChevronRight, Download, ExternalLink, LoaderCircle, RefreshCw } from 'lucide-react'
import { HARNESS_METHODS, type ChatAgentId, type ChatAgentInfo } from '@acp-harness/protocol'
import { harnessRequest } from '@/daemon-connection'
import type { HostEntry } from '@/session-store'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { TuiAgentIcon } from '@/components/terminal/TuiAgentIcon'
import { loadChatAgents, setChatAgents, useChatAgents } from '@/lib/chat-agents'
import { cn } from '@/lib/utils'
import { SettingsRow, TextField } from './settings-form-controls'
import { SearchableSetting, useSettingsSearchQuery } from './SettingsSection'
import { t } from '@/i18n/i18n'

// Orca's HostAgentLaunchSettings and HostAgentEnvironmentEditor: per host, each chat agent's
// launch command and environment. Values are write-only: the daemon reports names, never values.
// An account is the agent's account-folder variable (CODEX_HOME, CLAUDE_CONFIG_DIR…) set here.
// Each agent folds to one line, and agents the host lacks gather in a folded group of their own.

const STATUS_LABEL: Record<ChatAgentInfo['status'], string> = {
  ready: t('Ready'),
  missing: t('Not installed'),
  'needs-adapter': t('Needs adapter'),
  unsupported: t('No chat mode')
}

type LaunchPatch = { command?: string | null; env?: { name: string; value: string | null } }

async function setLaunch(host: HostEntry, agent: ChatAgentId, patch: LaunchPatch): Promise<void> {
  setChatAgents(host.id, await harnessRequest(HARNESS_METHODS.chatAgentSetLaunch, { agent, ...patch }, host.id))
}

export function ChatAgentLaunchSettings({ host }: { host: HostEntry }) {
  const state = useChatAgents(host.id)
  const searching = useSettingsSearchQuery().trim() !== ''
  const installed = state.agents.filter((a) => a.status !== 'missing')
  const missing = state.agents.filter((a) => a.status === 'missing')
  const [missingOpen, setMissingOpen] = useState(false)
  return (
    <div className="space-y-1" data-chat-agent-settings={host.id}>
      <div className="flex items-center justify-between gap-2 pt-2">
        <span className="text-xs font-medium text-muted-foreground">{host.label}</span>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          disabled={state.kind === 'loading'}
          onClick={() => void loadChatAgents(host.id, true)}
        >
          <RefreshCw className={cn('size-3', state.kind === 'loading' && 'animate-spin')} />
          {t('Refresh')}
        </Button>
      </div>
      {state.kind === 'failed' && state.agents.length === 0 ? (
        <p className="py-2 text-xs text-muted-foreground">{t('Can’t reach this host to list its agents: {reason}', { reason: state.reason })}</p>
      ) : null}
      <div className="divide-y divide-border/40">
        {installed.map((agent) => (
          <ChatAgentRow key={agent.id} host={host} agent={agent} />
        ))}
      </div>
      {missing.length > 0 ? (
        <Collapsible
          open={searching || missingOpen}
          onOpenChange={setMissingOpen}
          className={searching ? 'not-has-[[data-setting-row]]:hidden' : undefined}
          data-chat-agents-missing
        >
          <CollapsibleTrigger className="group flex w-full items-center gap-2 rounded-md py-2 text-left text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50">
            <ChevronRight className="size-3.5 shrink-0 transition-transform group-data-[state=open]:rotate-90" />
            {t('Not installed on this host ({count})', { count: missing.length })}
            <span className="flex min-w-0 items-center gap-1">
              {missing.map((agent) => (
                <TuiAgentIcon key={agent.id} agent={agent.id} size={12} />
              ))}
            </span>
          </CollapsibleTrigger>
          <CollapsibleContent animation="height">
            <div className="divide-y divide-border/40">
              {missing.map((agent) => (
                <ChatAgentRow key={agent.id} host={host} agent={agent} />
              ))}
            </div>
          </CollapsibleContent>
        </Collapsible>
      ) : null}
    </div>
  )
}

/** One agent, folded to its name and state; open, its launch command and environment. */
function ChatAgentRow({ host, agent }: { host: HostEntry; agent: ChatAgentInfo }) {
  const searching = useSettingsSearchQuery().trim() !== ''
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [install, setInstall] = useState<{ phase: 'running' } | { phase: 'failed'; output: string } | null>(null)
  const run = (patch: LaunchPatch) =>
    setLaunch(host, agent.id, patch).then(
      () => setError(null),
      (e: unknown) => setError(e instanceof Error ? e.message : String(e))
    )
  const startInstall = () => {
    setInstall({ phase: 'running' })
    harnessRequest(HARNESS_METHODS.chatAgentInstall, { agent: agent.id }, host.id).then(
      (result) => {
        setChatAgents(host.id, result.agents)
        if (result.ok) setInstall(null)
        else {
          setInstall({ phase: 'failed', output: result.output })
          setOpen(true)
        }
      },
      (e: unknown) => {
        setInstall({ phase: 'failed', output: e instanceof Error ? e.message : String(e) })
        setOpen(true)
      }
    )
  }
  return (
    <Collapsible open={searching || open} onOpenChange={setOpen} className="not-has-[[data-setting-row]]:hidden" data-chat-agent={agent.id}>
      <SearchableSetting entry={{ title: agent.label, keywords: [agent.id, 'agent', 'install'] }}>
        <div className="flex items-center gap-2 py-1.5">
          <CollapsibleTrigger className="group flex min-w-0 flex-1 items-center gap-2 rounded-md py-1 text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50">
            <ChevronRight className="size-3.5 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-90" />
            <TuiAgentIcon agent={agent.id} size={16} />
            <span className="text-sm font-medium">{agent.label}</span>
            <span
              className={cn('text-xs', agent.status === 'ready' ? 'text-muted-foreground' : 'text-status-warning')}
              data-chat-agent-status={agent.status}
            >
              {STATUS_LABEL[agent.status]}
            </span>
          </CollapsibleTrigger>
          <InstallAction agent={agent} running={install?.phase === 'running'} onInstall={startInstall} />
        </div>
      </SearchableSetting>
      <CollapsibleContent animation="height">
        <div className="space-y-2 pb-3 pl-6">
          {agent.detail ? <p className="font-mono text-xs break-all text-muted-foreground">{agent.detail}</p> : null}
          {agent.installCommand ? (
            <InstallHint>
              {t('Install runs this on {host}:', { host: host.label })}{' '}
              <code className="font-mono break-all">{agent.installCommand}</code>
            </InstallHint>
          ) : null}
          {install?.phase === 'failed' ? (
            <div className="space-y-1">
              <p className="text-xs text-destructive">{t('The install did not finish.')}</p>
              {install.output ? (
                <pre className="max-h-40 overflow-auto rounded-md bg-muted/50 p-2 font-mono text-[11px] whitespace-pre-wrap text-muted-foreground">
                  {install.output}
                </pre>
              ) : null}
            </div>
          ) : null}
          {agent.id !== 'claude' ? (
            <TextField
              label={t('{agent} command', { agent: agent.label })}
              description={t('Starts this agent’s ACP server. Empty uses the catalog command.')}
              keywords={[agent.id, 'command', 'acp']}
              value={agent.command ?? ''}
              placeholder={t('Catalog command')}
              className="w-72 font-mono text-xs"
              onChange={(value) => void run({ command: value || null })}
            />
          ) : null}
          <EnvironmentEditor agent={agent} onChange={(env) => run({ env })} />
          {error ? <p className="text-xs text-destructive">{error}</p> : null}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

/** Install (or add the missing adapter) where the daemon knows how; otherwise the agent's own guide. */
function InstallAction({ agent, running, onInstall }: { agent: ChatAgentInfo; running: boolean; onInstall: () => void }) {
  if (agent.status === 'ready') return null
  if (agent.installCommand) {
    const label = agent.status === 'needs-adapter' ? t('Install adapter') : agent.status === 'unsupported' ? t('Update') : t('Install')
    return (
      <Button type="button" size="xs" variant="outline" disabled={running} onClick={onInstall} data-chat-agent-install={agent.id}>
        {running ? <LoaderCircle className="size-3 animate-spin" /> : <Download className="size-3" />}
        {running ? t('Installing…') : label}
      </Button>
    )
  }
  if (!agent.installUrl) return null
  const url = agent.installUrl
  return (
    <Button type="button" size="xs" variant="ghost" onClick={() => window.open(url, '_blank', 'noopener')}>
      <ExternalLink className="size-3" />
      {t('Install guide')}
    </Button>
  )
}

function InstallHint({ children }: { children: ReactNode }) {
  return <p className="text-xs text-muted-foreground">{children}</p>
}

function EnvironmentEditor({
  agent,
  onChange
}: {
  agent: ChatAgentInfo
  onChange: (env: { name: string; value: string | null }) => Promise<void>
}) {
  const [newName, setNewName] = useState('')
  return (
    <SettingsRow
      label={t('{agent} environment', { agent: agent.label })}
      description={
        agent.accountVariable
          ? t('Variables this host starts {agent} with. Set {variable} to run another account.', { agent: agent.label, variable: agent.accountVariable })
          : t('Variables this host starts {agent} with (API keys, an account’s config folder).', { agent: agent.label })
      }
      keywords={[agent.id, 'environment', 'account', 'profile', ...(agent.accountVariable ? [agent.accountVariable] : [])]}
      alignTop
      control={
        <div className="w-72 space-y-2">
          {agent.envNames.map((name) => (
            <EnvironmentValueRow key={name} name={name} saved onSave={(value) => onChange({ name, value })} />
          ))}
          <Input
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            aria-label={t('New {agent} environment variable name', { agent: agent.label })}
            placeholder={agent.accountVariable && !agent.envNames.includes(agent.accountVariable) ? agent.accountVariable : t('Variable name')}
            spellCheck={false}
            className="h-7 font-mono text-xs"
          />
          {newName.trim() ? (
            <EnvironmentValueRow
              key={newName.trim()}
              name={newName.trim()}
              saved={false}
              onSave={async (value) => {
                await onChange({ name: newName.trim(), value })
                setNewName('')
              }}
            />
          ) : null}
        </div>
      }
    />
  )
}

function EnvironmentValueRow({
  name,
  saved,
  onSave
}: {
  name: string
  saved: boolean
  onSave: (value: string | null) => Promise<void>
}) {
  const [value, setValue] = useState('')
  const [pending, setPending] = useState(false)
  const write = (next: string | null) => {
    setPending(true)
    void onSave(next).finally(() => {
      setPending(false)
      setValue('')
    })
  }
  return (
    <div className="space-y-1" data-env-name={name}>
      <span className="font-mono text-xs text-muted-foreground">{name}</span>
      <div className="flex items-center gap-2">
        <Input
          type="password"
          autoComplete="off"
          value={value}
          readOnly={pending}
          onChange={(event) => setValue(event.target.value)}
          aria-label={t('Value for {name}', { name })}
          placeholder={saved ? t('Saved value · enter to replace') : t('Value')}
          spellCheck={false}
          className="h-7 text-xs"
        />
        <Button type="button" size="xs" disabled={!value || pending} onClick={() => write(value)}>
          {t('Save')}
        </Button>
        {saved ? (
          <Button type="button" variant="ghost" size="xs" disabled={pending} onClick={() => write(null)}>
            {t('Remove')}
          </Button>
        ) : null}
      </div>
    </div>
  )
}
