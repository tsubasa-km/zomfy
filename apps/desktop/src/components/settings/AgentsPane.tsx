import { useStore, type HostEntry } from '@/session-store'
import { updateHostSettings, useHostSettings } from '@/stores/host-settings-store'
import { ClaudeIcon } from '@/components/agent-icons'
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

export function AgentsPane() {
  const hosts = useStore((s) => s.hosts)
  return (
    <div className="space-y-8">
      <div className="space-y-2 not-has-[[data-setting-row]]:hidden">
        <SettingsSubsectionHeader title="Default agent" description="New agent tabs start this agent; the + menu starts the others." />
        <SettingsRow
          label="Default agent"
          keywords={['claude', 'agent']}
          control={
            <span className="inline-flex items-center gap-2 text-sm">
              <ClaudeIcon size={16} />
              Claude Code
            </span>
          }
        />
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
