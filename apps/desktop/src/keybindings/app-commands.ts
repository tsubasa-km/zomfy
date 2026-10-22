import { getState, setDashboardOpen, setFloating, setRightSidebar, floatingWorkspaceId, type RightSidebarTab } from '@/session-store'
import { getAppOverlays, openSettings, setCommandPalette, setQuickOpen } from '@/stores/app-overlay-store'
import { getSetting, setSetting } from '@/stores/settings-store'
import { stepZoom } from '@/lib/ui-zoom'
import { setAutomationsPageOpen } from '@/stores/automation-store'
import { focusedWorkspaceId, jumpToAgentNeedingYou, selectWorkspaceByIndex, stepWorkspace } from '@/lib/workspace-navigation'
import { registerCommandHandler, type CommandHandler } from './keybinding-registry'

/** Orca's right sidebar toggles: open on that tab, or close when it is already showing. */
function toggleRightSidebarTab(tab: RightSidebarTab): void {
  const current = getState().rightSidebar
  setRightSidebar(current.open && current.tab === tab ? { open: false } : { open: true, tab })
}

const APP_COMMAND_HANDLERS: Record<string, CommandHandler> = {
  'app.quickOpen': () => {
    if (getAppOverlays().quickOpen.open) return setQuickOpen(null)
    const target = focusedWorkspaceId()
    if (!target) return false
    setQuickOpen(target)
  },
  'app.commandPalette': () => setCommandPalette(!getAppOverlays().commandPalette),
  'workspace.palette': () => {
    const { commandPalette, commandPaletteMode } = getAppOverlays()
    setCommandPalette(!(commandPalette && commandPaletteMode === 'workspaces'), 'workspaces')
  },
  'app.settings': () => openSettings(),
  'app.shortcuts': () => openSettings('shortcuts'),
  'app.forceReload': () => window.location.reload(),
  'workspace.navigateUp': () => stepWorkspace(-1),
  'workspace.navigateDown': () => stepWorkspace(1),
  'workspace.selectByIndex': ({ index }) => selectWorkspaceByIndex(index),
  'agent.jumpToNeedsYou': () => jumpToAgentNeedingYou(),
  'dashboard.toggle': () => setDashboardOpen(!getState().dashboardOpen),
  'floatingWorkspace.toggle': () => {
    if (!floatingWorkspaceId()) return false
    setFloating({ open: !getState().floating.open })
  },
  'sidebar.right.toggle': () => setRightSidebar({ open: !getState().rightSidebar.open }),
  'sidebar.explorer.toggle': () => toggleRightSidebarTab('explorer'),
  'sidebar.search.toggle': () => toggleRightSidebarTab('search'),
  'sidebar.sourceControl.toggle': () => toggleRightSidebarTab('source-control'),
  'sidebar.checks.toggle': () => toggleRightSidebarTab('checks'),
  'sidebar.ports.toggle': () => toggleRightSidebarTab('ports'),
  'automations.open': () => setAutomationsPageOpen(true),
  'sidebar.sideChat.toggle': () => toggleRightSidebarTab('side-chat'),
  'statusBar.toggle': () => setSetting('statusBarVisible', !getSetting('statusBarVisible')),
  'zoom.in': () => stepZoom('in'),
  'zoom.out': () => stepZoom('out'),
  'zoom.reset': () => stepZoom('reset'),
  'theme.system': () => setSetting('theme', 'system'),
  'theme.dark': () => setSetting('theme', 'dark'),
  'theme.light': () => setSetting('theme', 'light')
}

/** Wires the app-shell commands to the registry once, at startup. */
export function installAppCommands(): void {
  for (const [id, handler] of Object.entries(APP_COMMAND_HANDLERS)) registerCommandHandler(id, handler)
}
