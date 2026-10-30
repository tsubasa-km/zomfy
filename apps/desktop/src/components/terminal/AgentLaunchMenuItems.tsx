import { MessageSquarePlus, RefreshCw } from 'lucide-react'
import { tuiAgentSpec } from '@acp-harness/protocol'
import { launchAgentTerminal } from '@/lib/agent-terminal-launch'
import { DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator } from '@/components/ui/dropdown-menu'
import { TuiAgentIcon } from '@/components/terminal/TuiAgentIcon'
import { requestAgentLaunchDialog } from '@/components/terminal/AgentLaunchDialog'
import { loadDetectedAgents, useDetectedAgents } from '@/lib/detected-agents'
import { LOCAL_HOST, allWorkspaces, useStore } from '@/session-store'
import { t } from '@/i18n/i18n'

/** The "+" menu's agent section (Orca's QuickLaunchAgentMenuItems), listing CLIs found on the workspace's host. */
export function AgentLaunchMenuItems({ workspaceId }: { workspaceId: string }) {
  const hostId = useStore((s) => allWorkspaces(s).find((w) => w.id === workspaceId)?.hostId ?? LOCAL_HOST)
  const detected = useDetectedAgents(hostId)
  const agents = detected.kind === 'ready' ? detected.agents : []
  return (
    <>
      <DropdownMenuSeparator />
      <DropdownMenuLabel className="text-xs text-muted-foreground">{t('Agents')}</DropdownMenuLabel>
      {agents.length === 0 && (
        <DropdownMenuItem disabled className="text-muted-foreground">
          {detected.kind === 'loading'
            ? t('Looking for agents…')
            : detected.kind === 'failed'
              ? t('Can’t reach this workspace’s host to list its agents')
              : t('No agents detected')}
        </DropdownMenuItem>
      )}
      {agents.map((agent) => {
        const label = tuiAgentSpec(agent)?.label ?? agent
        return (
          <DropdownMenuItem
            key={agent}
            data-launch-agent={agent}
            title={t('Launch {agent} in a new terminal', { agent: label })}
            onSelect={() => void launchAgentTerminal(workspaceId, agent)}
          >
            <TuiAgentIcon agent={agent} size={14} />
            <span className="flex-1">{label}</span>
          </DropdownMenuItem>
        )
      })}
      {agents.length > 0 && (
        <DropdownMenuItem data-launch-agent-prompt onSelect={() => requestAgentLaunchDialog(workspaceId)}>
          <MessageSquarePlus />
          {t('Launch Agent with Prompt…')}
        </DropdownMenuItem>
      )}
      <DropdownMenuItem
        className="text-muted-foreground"
        onSelect={(event) => {
          // Keep the menu open so the refreshed list shows in place.
          event.preventDefault()
          void loadDetectedAgents(hostId, true)
        }}
      >
        <RefreshCw />
        {t('Refresh Agents')}
      </DropdownMenuItem>
    </>
  )
}
