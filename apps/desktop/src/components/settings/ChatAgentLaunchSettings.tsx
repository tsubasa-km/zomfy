import { useState, type ReactNode } from 'react'
import { ChevronRight, ExternalLink, RefreshCw, ShieldAlert } from 'lucide-react'
import { HARNESS_METHODS, type ChatAgentId, type ChatAgentInfo } from '@zomfy/protocol'
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
  unsupported: t('No chat mode'),
  'needs-consent': t('Off')
}

type LaunchPatch = { command?: string | null; env?: { name: string; value: string | null }; consent?: boolean }

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
          {t('Reload')}
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
  const run = (patch: LaunchPatch) =>
    setLaunch(host, agent.id, patch).then(
      () => setError(null),
      (e: unknown) => setError(e instanceof Error ? e.message : String(e))
    )
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
            {agent.update ? (
              <span className="text-xs text-primary" data-chat-agent-update={agent.update.latest}>
                {t('Update available: {version}', { version: agent.update.latest })}
              </span>
            ) : null}
          </CollapsibleTrigger>
          <InstallLink agent={agent} />
        </div>
      </SearchableSetting>
      <CollapsibleContent animation="height">
        <div className="space-y-2 pb-3 pl-6">
          {agent.consent !== undefined ? <ConsentSection agent={agent} onChange={(consent) => run({ consent })} /> : null}
          {agent.detail && agent.status !== 'needs-consent' ? <p className="font-mono text-xs break-all text-muted-foreground">{agent.detail}</p> : null}
          {agent.update ? (
            <InstallHint>
              {t('{package} {installed} is installed; {latest} is out. Update it the way you installed it.', {
                package: agent.update.packageName,
                installed: agent.update.installed,
                latest: agent.update.latest
              })}
            </InstallHint>
          ) : agent.status !== 'ready' && agent.status !== 'needs-consent' ? (
            <InstallHint>{t('Install it on {host} from the official page, then press Reload.', { host: host.label })}</InstallHint>
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

/** The vendor's page for what this host lacks: the agent, its adapter, or a newer release. */
function InstallLink({ agent }: { agent: ChatAgentInfo }) {
  if (((agent.status === 'ready' || agent.status === 'needs-consent') && !agent.update) || !agent.installUrl) return null
  const url = agent.installUrl
  const label =
    agent.status === 'needs-adapter'
      ? t('Get the adapter')
      : agent.status === 'unsupported' || agent.update
        ? t('How to update')
        : t('Install guide')
  return (
    <Button type="button" size="xs" variant="outline" onClick={() => window.open(url, '_blank', 'noopener')} data-chat-agent-install-link={agent.id}>
      <ExternalLink className="size-3" />
      {label}
    </Button>
  )
}

const ANTIGRAVITY_FAQ_URL = 'https://antigravity.google/docs/faq'

/**
 * A guarded agent (GUARDED_CHAT_AGENTS): off until the person turns it on, having read why. On, it
 * still runs only in threads they start; automations, workflows, side chats and agent switches refuse it.
 */
function ConsentSection({ agent, onChange }: { agent: ChatAgentInfo; onChange: (consent: boolean) => Promise<void> }) {
  const [asking, setAsking] = useState(false)
  return (
    <div className="space-y-2 rounded-md border border-status-warning/40 bg-status-warning/5 p-3 text-xs" data-chat-agent-consent={agent.consent ? 'on' : 'off'}>
      <p className="flex items-start gap-2 font-medium">
        <ShieldAlert className="mt-0.5 size-3.5 shrink-0 text-status-warning" />
        {t('Google forbids using {agent} from other apps on consumer plans, and suspends accounts that do.', { agent: agent.label })}
      </p>
      <p className="text-muted-foreground">
        {t(
          'Zomfy starts it only in threads you start yourself, never from automations, workflows, side chats or by switching a thread’s agent. Even so, Google may treat any use from Zomfy as a breach. With a Google AI Studio or Gemini Enterprise API key, use Gemini CLI instead.'
        )}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="link" size="xs" className="h-auto px-0" onClick={() => window.open(ANTIGRAVITY_FAQ_URL, '_blank', 'noopener')}>
          <ExternalLink className="size-3" />
          {t('Read Google’s FAQ')}
        </Button>
        <span className="flex-1" />
        {agent.consent ? (
          <Button type="button" variant="outline" size="xs" onClick={() => void onChange(false)} data-chat-agent-consent-off>
            {t('Turn off')}
          </Button>
        ) : asking ? (
          <>
            <Button type="button" variant="ghost" size="xs" onClick={() => setAsking(false)}>
              {t('Cancel')}
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="xs"
              onClick={() => void onChange(true).then(() => setAsking(false))}
              data-chat-agent-consent-confirm
            >
              {t('I accept the risk, turn it on')}
            </Button>
          </>
        ) : (
          <Button type="button" variant="outline" size="xs" onClick={() => setAsking(true)} data-chat-agent-consent-on>
            {t('Turn on…')}
          </Button>
        )}
      </div>
    </div>
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
