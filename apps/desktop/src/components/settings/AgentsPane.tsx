import { useStore, type HostEntry } from '@/session-store'
import { updateHostSettings, useHostSettings } from '@/stores/host-settings-store'
import { LOCAL_HOST } from '@/session-store'
import { setSetting, useSetting } from '@/stores/settings-store'
import { useChatAgents } from '@/lib/chat-agents'
import { TuiAgentIcon } from '@/components/terminal/TuiAgentIcon'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { SettingsRow, SettingsSubsectionHeader, TextField } from './settings-form-controls'
import { sortedHosts } from './HostsPane'
import { ChatAgentLaunchSettings } from './ChatAgentLaunchSettings'

function ClaudeCommandRow({ host }: { host: HostEntry }) {
  const settings = useHostSettings(host.id)
  if (!settings) {
    return (
      <SettingsRow
        label={`Claude Code command · ${host.label}`}
        keywords={['claude', 'path', 'executable', 'cli']}
        control={<span className="text-xs text-muted-foreground">{host.connection.kind === 'connected' ? 'Loading…' : 'Host offline'}</span>}
      />
    )
  }
  return (
    <TextField
      label={`Claude Code command · ${host.label}`}
      description="Path to the CLI agent turns run on this host. Empty finds `claude` on PATH."
      keywords={['claude', 'path', 'executable', 'cli']}
      value={settings.claudeExecutablePath ?? ''}
      placeholder="claude"
      className="w-72 font-mono text-xs"
      onChange={(value) => void updateHostSettings(host.id, { claudeExecutablePath: value || null })}
    />
  )
}

/** Orca's default-agent picker, over the chat agents this computer can run. */
function DefaultAgentSelect() {
  const value = useSetting('defaultChatAgent')
  const ready = useChatAgents(LOCAL_HOST).agents.filter((a) => a.status === 'ready')
  const options = ready.some((a) => a.id === 'claude') ? ready : [{ id: 'claude' as const, label: 'Claude' }, ...ready]
  return (
    <Select value={value} onValueChange={(v) => setSetting('defaultChatAgent', v)}>
      <SelectTrigger className="h-8 w-48" aria-label="Default agent" data-default-agent>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((a) => (
          <SelectItem key={a.id} value={a.id}>
            <TuiAgentIcon agent={a.id} size={14} />
            {a.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

export function AgentsPane() {
  const hosts = useStore((s) => s.hosts)
  return (
    <div className="space-y-8">
      <div className="space-y-2 not-has-[[data-setting-row]]:hidden">
        <SettingsSubsectionHeader title="Default agent" description="New workspaces start a chat with this agent; the + menu starts any of them." />
        <SettingsRow label="Default agent" keywords={['claude', 'agent']} control={<DefaultAgentSelect />} />
      </div>
      <div className="space-y-2 not-has-[[data-setting-row]]:hidden">
        <SettingsSubsectionHeader title="Claude Code" description="Each host's daemon runs its own CLI with that host's login and settings." />
        <div className="divide-y divide-border/40">
          {sortedHosts(hosts).map((host) => (
            <ClaudeCommandRow key={host.id} host={host} />
          ))}
        </div>
      </div>
      <div className="space-y-2">
        <SettingsSubsectionHeader
          title="Chat agents"
          description="Agents each host can run as chats. Other agents run their own ACP server on the host, with that host’s login, command and variables."
        />
        {sortedHosts(hosts)
          .filter((host) => host.connection.kind === 'connected')
          .map((host) => (
            <ChatAgentLaunchSettings key={host.id} host={host} />
          ))}
      </div>
    </div>
  )
}
