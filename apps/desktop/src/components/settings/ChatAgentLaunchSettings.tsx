import { useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { HARNESS_METHODS, type ChatAgentId, type ChatAgentInfo } from '@acp-harness/protocol'
import { harnessRequest } from '@/daemon-connection'
import type { HostEntry } from '@/session-store'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { TuiAgentIcon } from '@/components/terminal/TuiAgentIcon'
import { loadChatAgents, setChatAgents, useChatAgents } from '@/lib/chat-agents'
import { cn } from '@/lib/utils'
import { SettingsRow, TextField } from './settings-form-controls'

// Orca's HostAgentLaunchSettings and HostAgentEnvironmentEditor: per host, each chat agent's
// launch command and environment. Values are write-only: the daemon reports names, never values.
// An account is the agent's account-folder variable (CODEX_HOME, CLAUDE_CONFIG_DIR…) set here.

const STATUS_LABEL: Record<ChatAgentInfo['status'], string> = {
  ready: 'Ready',
  missing: 'Not installed',
  'needs-adapter': 'Needs adapter',
  unsupported: 'No chat mode'
}

type LaunchPatch = { command?: string | null; env?: { name: string; value: string | null } }

async function setLaunch(host: HostEntry, agent: ChatAgentId, patch: LaunchPatch): Promise<void> {
  setChatAgents(host.id, await harnessRequest(HARNESS_METHODS.chatAgentSetLaunch, { agent, ...patch }, host.id))
}

export function ChatAgentLaunchSettings({ host }: { host: HostEntry }) {
  const state = useChatAgents(host.id)
  const installed = state.agents.filter((a) => a.status !== 'missing')
  const missing = state.agents.filter((a) => a.status === 'missing')
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
          <RefreshCw className="size-3" />
          Refresh
        </Button>
      </div>
      {state.kind === 'failed' && state.agents.length === 0 ? (
        <p className="py-2 text-xs text-muted-foreground">Can’t reach this host to list its agents: {state.reason}</p>
      ) : null}
      <div className="divide-y divide-border/40">
        {installed.map((agent) => (
          <ChatAgentRow key={agent.id} host={host} agent={agent} />
        ))}
      </div>
      {missing.length > 0 ? (
        <p className="py-2 text-xs text-muted-foreground">
          Not installed on this host: {missing.map((a) => a.label).join(', ')}
        </p>
      ) : null}
    </div>
  )
}

function ChatAgentRow({ host, agent }: { host: HostEntry; agent: ChatAgentInfo }) {
  const [error, setError] = useState<string | null>(null)
  const run = (patch: LaunchPatch) =>
    setLaunch(host, agent.id, patch).then(
      () => setError(null),
      (e: unknown) => setError(e instanceof Error ? e.message : String(e))
    )
  return (
    <div className="space-y-2 py-3" data-chat-agent={agent.id}>
      <div className="flex items-center gap-2">
        <TuiAgentIcon agent={agent.id} size={16} />
        <span className="text-sm font-medium">{agent.label}</span>
        <span
          className={cn('text-xs', agent.status === 'ready' ? 'text-muted-foreground' : 'text-status-warning')}
          data-chat-agent-status={agent.status}
        >
          {STATUS_LABEL[agent.status]}
        </span>
      </div>
      {agent.detail ? <p className="font-mono text-xs break-all text-muted-foreground">{agent.detail}</p> : null}
      {agent.id !== 'claude' ? (
        <TextField
          label={`${agent.label} command`}
          description="Starts this agent’s ACP server. Empty uses the catalog command."
          keywords={[agent.id, 'command', 'acp']}
          value={agent.command ?? ''}
          placeholder="Catalog command"
          className="w-72 font-mono text-xs"
          onChange={(value) => void run({ command: value || null })}
        />
      ) : null}
      <EnvironmentEditor agent={agent} onChange={(env) => run({ env })} />
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  )
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
      label={`${agent.label} environment`}
      description={
        agent.accountVariable
          ? `Variables this host starts ${agent.label} with. Set ${agent.accountVariable} to run another account.`
          : `Variables this host starts ${agent.label} with (API keys, an account’s config folder).`
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
            aria-label={`New ${agent.label} environment variable name`}
            placeholder={agent.accountVariable && !agent.envNames.includes(agent.accountVariable) ? agent.accountVariable : 'Variable name'}
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
          aria-label={`Value for ${name}`}
          placeholder={saved ? 'Saved value · enter to replace' : 'Value'}
          spellCheck={false}
          className="h-7 text-xs"
        />
        <Button type="button" size="xs" disabled={!value || pending} onClick={() => write(value)}>
          Save
        </Button>
        {saved ? (
          <Button type="button" variant="ghost" size="xs" disabled={pending} onClick={() => write(null)}>
            Remove
          </Button>
        ) : null}
      </div>
    </div>
  )
}
