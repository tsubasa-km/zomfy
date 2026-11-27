import type { ChatAgentInfo } from '@zomfy/protocol'
import { LOCAL_HOST, useStore, type HostEntry } from '@/session-store'
import { setSetting, useSetting } from '@/stores/settings-store'
import { useChatAgents } from '@/lib/chat-agents'
import { TuiAgentIcon } from '@/components/terminal/TuiAgentIcon'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { sortedHosts } from './HostsPane'
import { t } from '@/i18n/i18n'

// Settings that belong to one host and one agent (docs/specs/settings-host-agent-scope.md): the
// pair is picked at the top of the page and remembered for every such page.

export interface HostAgentPick {
  host: HostEntry | null
  agent: ChatAgentInfo | null
  /** Every chat agent the host knows, installed or not. */
  agents: ChatAgentInfo[]
  hosts: HostEntry[]
}

/**
 * The remembered pair, or the first connected host and its first ready agent while the remembered
 * one is not there; falling back does not overwrite what was remembered.
 */
export function useHostAgentPick(): HostAgentPick {
  const allHosts = useStore((s) => s.hosts)
  const savedHost = useSetting('settingsHost')
  const savedAgent = useSetting('settingsAgent')
  const hosts = sortedHosts(allHosts).filter((h) => h.connection.kind === 'connected')
  const host = hosts.find((h) => h.id === savedHost) ?? hosts[0] ?? null
  const { agents } = useChatAgents(host?.id ?? LOCAL_HOST)
  const agent = agents.find((a) => a.id === savedAgent) ?? agents.find((a) => a.status === 'ready') ?? agents[0] ?? null
  return { host, agent, agents: host ? agents : [], hosts }
}

export function HostAgentPicker({ pick }: { pick: HostAgentPick }) {
  const { host, agent, agents, hosts } = pick
  return (
    <div className="flex items-center gap-2" data-host-agent-picker>
      <Select value={host?.id ?? ''} onValueChange={(id) => setSetting('settingsHost', id)}>
        <SelectTrigger className="h-8 w-44" aria-label={t('Host')} data-settings-host>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {hosts.map((h) => (
            <SelectItem key={h.id} value={h.id}>
              {h.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={agent?.id ?? ''} onValueChange={(id) => setSetting('settingsAgent', id)}>
        <SelectTrigger className="h-8 w-48" aria-label={t('Agent')} data-settings-agent>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {agents.map((a) => (
            <SelectItem
              key={a.id}
              value={a.id}
              title={a.status === 'ready' ? undefined : (a.detail ?? undefined)}
              className={cn(a.status === 'missing' && 'opacity-50')}
              data-settings-agent-option={a.id}
            >
              <TuiAgentIcon agent={a.id} size={14} />
              {a.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
