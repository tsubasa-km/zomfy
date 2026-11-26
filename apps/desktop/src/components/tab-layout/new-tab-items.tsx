import { useEffect } from 'react'
import { Globe, Server, SquareTerminal, Workflow as WorkflowIcon } from 'lucide-react'
import { toast } from 'sonner'
import { HARNESS_METHODS, tuiAgentSpec, type ChatAgentId, type Workflow } from '@zomfy/protocol'
import { createSession, harnessRequest } from '@/daemon-connection'
import { LOCAL_HOST, allProjects, allWorkspaces, inWindowTabs, openStartTab, useStore, type HostId } from '@/session-store'
import { TuiAgentIcon } from '@/components/terminal/TuiAgentIcon'
import { QuickCommandIcon } from '@/components/terminal/QuickCommandsButton'
import { useChatAgents } from '@/lib/chat-agents'
import { useDetectedAgents } from '@/lib/detected-agents'
import { launchAgentTerminal } from '@/lib/agent-terminal-launch'
import { commandsForProject, runQuickCommandInNewTab, useQuickCommands } from '@/lib/quick-commands'
import { openSshConnection, useSshConnections } from '@/lib/ssh-connections'
import { togglePin, unpin } from '@/lib/new-tab-pins'
import { getSetting, setSetting, useSetting } from '@/stores/settings-store'
import { setStartProject } from '@/stores/sidebar-store'
import { setNewThreadAgent } from '@/stores/new-thread-store'
import { createExternalStore } from '@/stores/external-store'
import { projectLabel } from '@/components/sidebar/workspace-visibility'
import { shortcutLabel } from './tab-shortcuts'
import { openBrowserTab, openPanelTab } from './workspace-tab-model'
import { useWorkspacePanels } from './workspace-panels'
import { requestNewTerminal, requestWorkflowRun } from './NewTabDialogs'
import { t } from '@/i18n/i18n'

// What the "+" menu can add, one hook per kind, shared by the menu and the pinned buttons beside it
// (docs/specs/new-tab-menu-and-pins.md). A pinned button calls only its own kind's hook.

export interface NewTabItem {
  /** The id it is pinned by; null when it cannot be pinned. */
  pin: string | null
  /** Its name in the menu and the pinned button's tooltip. */
  label: string
  /** The pinned button's text; none shows the icon only. */
  short?: string
  icon: React.ReactNode
  run: () => void
  disabled?: boolean
  /** Why it is disabled, under its name. */
  detail?: string
  shortcut?: string
}

function useWorkspaceHost(workspaceId: string): HostId {
  return useStore((s) => allWorkspaces(s).find((w) => w.id === workspaceId)?.hostId ?? LOCAL_HOST)
}

function failed(what: string) {
  return (error: unknown) => toast.error(what, { description: error instanceof Error ? error.message : String(error) })
}

// ── Pins ─────────────────────────────────────────────────────────────────

export function useNewTabPins(): string[] {
  return useSetting('newTabPins')
}

export function toggleNewTabPin(id: string): void {
  setSetting('newTabPins', togglePin(getSetting('newTabPins'), id))
}

export function unpinNewTabItem(id: string): void {
  setSetting('newTabPins', unpin(getSetting('newTabPins'), id))
}

// ── Chats ────────────────────────────────────────────────────────────────

/**
 * A new chat with `agent`: the window's New thread screen, set to start in this workspace with the
 * person free to pick another place. A pop-out or floating workspace has no such screen, so the
 * chat starts there at once, as it always did.
 */
export function startNewChat(workspaceId: string, agent: ChatAgentId): void {
  if (!inWindowTabs(workspaceId)) {
    void createSession(workspaceId, agent).catch(failed(t('Could not start the thread')))
    return
  }
  setNewThreadAgent(agent)
  setStartProject(null)
  openStartTab(workspaceId)
}

export function useChatItems(workspaceId: string): NewTabItem[] {
  const { agents } = useChatAgents(useWorkspaceHost(workspaceId))
  const others = agents.filter((a) => a.id !== 'claude' && a.status !== 'missing')
  return [
    {
      pin: 'chat:claude',
      label: t('New Claude Thread'),
      short: t('{agent} chat', { agent: 'Claude' }),
      icon: <TuiAgentIcon agent="claude" size={14} />,
      run: () => startNewChat(workspaceId, 'claude')
    },
    ...others.map((agent) => ({
      pin: `chat:${agent.id}`,
      label: t('New {agent} Thread', { agent: agent.label }),
      short: t('{agent} chat', { agent: agent.label }),
      icon: <TuiAgentIcon agent={agent.id} size={14} />,
      run: () => startNewChat(workspaceId, agent.id),
      disabled: agent.status !== 'ready',
      detail: agent.status === 'ready' ? undefined : (agent.detail ?? undefined)
    }))
  ]
}

// ── Terminal, agents, commands ───────────────────────────────────────────

export function useTerminalItems(workspaceId: string): NewTabItem[] {
  return [
    {
      pin: 'terminal',
      label: t('New Terminal…'),
      icon: <SquareTerminal className="size-4" />,
      run: () => requestNewTerminal(workspaceId)
    }
  ]
}

export function useTuiAgentItems(workspaceId: string) {
  const detected = useDetectedAgents(useWorkspaceHost(workspaceId))
  const agents = detected.kind === 'ready' ? detected.agents : []
  const items: NewTabItem[] = agents.map((agent) => {
    const label = tuiAgentSpec(agent)?.label ?? agent
    return {
      pin: `agent:${agent}`,
      label,
      short: label,
      icon: <TuiAgentIcon agent={agent} size={14} />,
      run: () => void launchAgentTerminal(workspaceId, agent).catch(failed(t("Couldn't open a terminal")))
    }
  })
  return { detected, items }
}

export function useCommandItems(workspaceId: string): NewTabItem[] {
  const hostId = useWorkspaceHost(workspaceId)
  const projectId = useStore((s) => allWorkspaces(s).find((w) => w.id === workspaceId)?.projectId ?? null)
  const { project, global } = commandsForProject(useQuickCommands(hostId), projectId)
  return [...project, ...global].map((command) => ({
    pin: `command:${command.id}`,
    label: command.label,
    short: command.label,
    icon: <QuickCommandIcon command={command} />,
    run: () => runQuickCommandInNewTab(workspaceId, command)
  }))
}

// ── Workflows ────────────────────────────────────────────────────────────

/** Each project's workflows, by `host:project`, fetched when a menu or pin first needs them. */
const workflowLists = createExternalStore<Record<string, Workflow[]>>({})
const loading = new Set<string>()

function loadWorkflows(hostId: HostId, projectId: string): void {
  const key = `${hostId}:${projectId}`
  if (loading.has(key)) return
  loading.add(key)
  harnessRequest(HARNESS_METHODS.workflowsList, { projectId }, hostId)
    .then((list) => workflowLists.update((all) => ({ ...all, [key]: list })))
    .catch(() => undefined)
    .finally(() => loading.delete(key))
}

export function useWorkflowItems(workspaceId: string, refresh = false): NewTabItem[] {
  const workspace = useStore((s) => allWorkspaces(s).find((w) => w.id === workspaceId) ?? null)
  const hostId = workspace?.hostId ?? LOCAL_HOST
  const projectId = workspace?.projectId ?? null
  const project = useStore((s) => (projectId ? allProjects(s.hosts).find((p) => p.hostId === hostId && p.id === projectId) : undefined))
  const key = `${hostId}:${projectId}`
  const list = workflowLists.use((all) => all[key])
  useEffect(() => {
    if (projectId && (refresh || !workflowLists.get()[key])) loadWorkflows(hostId, projectId)
  }, [hostId, projectId, key, refresh])
  if (!projectId || !list) return []
  const projectName = project ? projectLabel(project) : ''
  return list.map((workflow) => ({
    pin: `workflow:${workflow.id}`,
    label: t('Run {name}…', { name: workflow.name }),
    short: workflow.name,
    icon: <WorkflowIcon className="size-4" />,
    run: () => requestWorkflowRun({ workspaceId, hostId, projectId, projectName, workflowId: workflow.id, name: workflow.name })
  }))
}

// ── SSH, browser, panels ─────────────────────────────────────────────────

export function useSshItems(workspaceId: string): NewTabItem[] {
  const connections = useSshConnections(useWorkspaceHost(workspaceId)) ?? []
  return [...connections]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((connection) => ({
      pin: `ssh:${connection.id}`,
      label: connection.name,
      short: connection.name,
      icon: <Server className="size-4" />,
      run: () => void openSshConnection(workspaceId, connection.id).catch(failed(t("Couldn't open a terminal")))
    }))
}

export function useBrowserItems(workspaceId: string): NewTabItem[] {
  return [
    {
      pin: 'browser',
      label: t('New Browser Tab'),
      icon: <Globe className="size-4" />,
      run: () => openBrowserTab(workspaceId),
      shortcut: shortcutLabel('tab.newBrowser') || undefined
    }
  ]
}

export function usePanelItems(workspaceId: string): NewTabItem[] {
  return useWorkspacePanels().map(({ id, label, icon: Icon }) => ({
    pin: id,
    label,
    icon: <Icon className="size-4" />,
    run: () => openPanelTab(workspaceId, id)
  }))
}
