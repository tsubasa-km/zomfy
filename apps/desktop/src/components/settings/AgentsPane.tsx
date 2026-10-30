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
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { MODES as PERMISSION_MODES, permissionModeLabel } from '@/components/native-chat/NativeChatPermissionModePicker'
import {
  claudeCliWarning,
  loadClaudeCliStatus,
  updateClaudeCliOn,
  useClaudeCliStatus,
  useClaudeCliUpdating
} from '@/stores/claude-cli-store'
import { t } from '@/i18n/i18n'

function ClaudeCommandRow({ host }: { host: HostEntry }) {
  const settings = useHostSettings(host.id)
  if (!settings) {
    return (
      <SettingsRow
        label={t('Claude Code command · {host}', { host: host.label })}
        keywords={['claude', 'path', 'executable', 'cli']}
        control={<span className="text-xs text-muted-foreground">{host.connection.kind === 'connected' ? t('Loading…') : t('Host offline')}</span>}
      />
    )
  }
  return (
    <>
      <TextField
        label={t('Claude Code command · {host}', { host: host.label })}
        description={t('Path to the CLI agent turns run on this host. Empty finds `claude` on PATH.')}
        keywords={['claude', 'path', 'executable', 'cli']}
        value={settings.claudeExecutablePath ?? ''}
        placeholder="claude"
        className="w-72 font-mono text-xs"
        onChange={(value) =>
          void updateHostSettings(host.id, { claudeExecutablePath: value || null }).then(() => loadClaudeCliStatus(host.id))
        }
      />
      <ClaudeVersionRow host={host} />
    </>
  )
}

function ClaudeVersionRow({ host }: { host: HostEntry }) {
  const status = useClaudeCliStatus(host.id)
  const busy = useClaudeCliUpdating(host.id)
  if (!status) return null
  const description = !status.path
    ? t('No `claude` command found; chats use the copy bundled with Zomfy, without your login.')
    : status.version === null
      ? t('`{path} --version` did not run.', { path: status.path })
      : status.outdated
        ? claudeCliWarning(status)
        : t('Up to date for Zomfy (built for {version}).', { version: status.expected })
  return (
    <SettingsRow
      label={t('Claude Code version · {host}', { host: host.label })}
      description={description}
      keywords={['claude', 'version', 'update', 'cli']}
      control={
        <div className="flex items-center gap-2">
          <span className={cn('font-mono text-xs', status.outdated ? 'text-amber-500' : 'text-muted-foreground')}>
            {status.version ?? '—'}
          </span>
          {status.path && (
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void updateClaudeCliOn(host.id)}>
              {busy ? t('Updating…') : t('Update')}
            </Button>
          )}
        </div>
      }
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
      <SelectTrigger className="h-8 w-48" aria-label={t('Default agent')} data-default-agent>
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

function DefaultPermissionSelect() {
  const value = useSetting('defaultPermissionMode')
  return (
    <Select value={value} onValueChange={(v) => setSetting('defaultPermissionMode', PERMISSION_MODES.find((m) => m === v) ?? 'auto')}>
      <SelectTrigger className="h-8 w-48" aria-label={t('Default permissions')} data-default-permission-mode>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {PERMISSION_MODES.map((mode) => (
          <SelectItem key={mode} value={mode}>
            {permissionModeLabel(mode)}
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
        <SettingsSubsectionHeader title={t('Default agent')} description={t('New workspaces start a chat with this agent; the + menu starts any of them.')} />
        <SettingsRow label={t('Default agent')} keywords={['claude', 'agent']} control={<DefaultAgentSelect />} />
        <SettingsRow
          label={t('Default permissions')}
          description={t('The mode new Claude chats start in; each chat can still change it.')}
          keywords={['permission', 'auto', 'approval', 'mode']}
          control={<DefaultPermissionSelect />}
        />
      </div>
      <div className="space-y-2 not-has-[[data-setting-row]]:hidden">
        <SettingsSubsectionHeader title="Claude Code" description={t("Each host's daemon runs its own CLI with that host's login and settings.")} />
        <div className="divide-y divide-border/40">
          {sortedHosts(hosts).map((host) => (
            <ClaudeCommandRow key={host.id} host={host} />
          ))}
        </div>
      </div>
      <div className="space-y-2">
        <SettingsSubsectionHeader
          title={t('Chat agents')}
          description={t('Agents each host can run as chats. Other agents run their own ACP server on the host, with that host’s login, command and variables.')}
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
