import { useEffect } from 'react'
import { HARNESS_METHODS, type PluginListEntry, type PluginsSnapshot } from '@acp-harness/protocol'
import { harnessRequest } from '@/daemon-connection'
import { LOCAL_HOST, useStore } from '@/session-store'
import { createExternalStore } from '@/stores/external-store'
import { registerKeybindingDefinitions, unregisterKeybindingDefinitions } from '@/keybindings/keybinding-definitions'
import { hasCommandHandler, registerCommandHandler, runCommand } from '@/keybindings/keybinding-registry'
import { t } from '@/i18n/i18n'

// Enabled plugins' contributions, wired into the app: palette commands and keybindings (Orca's
// plugin-command-registry + plugin-quick-actions) and right-sidebar panels (plugin-panels store).
// Plugins live on this computer's daemon; other hosts are never asked.

type PluginsState = { status: 'idle' | 'loading' | 'ready' | 'failed'; snapshot: PluginsSnapshot | null; error: string | null }

const store = createExternalStore<PluginsState>({ status: 'idle', snapshot: null, error: null })

export const usePlugins = store.use

/** Orca's PLUGIN_COMMAND_ALIAS_ACTION_IDS: the closed set of built-ins a declarative command may run. */
const ALIASABLE_ACTIONS = new Set([
  'worktree.history.back',
  'worktree.history.forward',
  'sidebar.left.toggle',
  'sidebar.sleepingWorkspaces.toggle',
  'floatingWorkspace.maximize',
  'tab.rename',
  'workspace.rename',
  'workspace.openBoard',
  'view.tasks',
  'sidebar.right.toggle',
  'sidebar.explorer.toggle',
  'sidebar.search.toggle',
  'sidebar.sourceControl.toggle',
  'sidebar.checks.toggle',
  'sidebar.ports.toggle'
])

/** Why a contributed command cannot run here, or null when it can. */
export function pluginCommandUnavailableReason(action: string | undefined): string | null {
  if (!action) return t('Needs a plugin worker, which acp-harness does not run')
  if (!ALIASABLE_ACTIONS.has(action)) return t('{action} is not an action plugins may alias', { action })
  if (!hasCommandHandler(action)) return t('{action} is not available in acp-harness', { action })
  return null
}

/** Orca's plugin keybinding action id. */
export function pluginCommandId(pluginKey: string, commandId: string): string {
  return `plugin:${pluginKey}/${commandId}`
}

export function pluginPanelTab(pluginKey: string, panelId: string): `plugin:${string}` {
  return `plugin:${pluginKey}/${panelId}`
}

export type ActivePluginPanel = { tab: `plugin:${string}`; pluginKey: string; pluginName: string; id: string; title: string; icon?: string }

export function enabledPlugins(state: PluginsState = store.get()): PluginListEntry[] {
  return (state.snapshot?.plugins ?? []).filter((p) => p.status === 'enabled' && p.manifest)
}

const NO_PANELS: ActivePluginPanel[] = []
let panelCache: { from: PluginsSnapshot | null; panels: ActivePluginPanel[] } = { from: null, panels: NO_PANELS }

/** Stable between snapshots, for useSyncExternalStore. */
export function useActivePluginPanels(): ActivePluginPanel[] {
  return store.use((state) => {
    if (panelCache.from !== state.snapshot) {
      const panels = enabledPlugins(state).flatMap((p) =>
        p.manifest!.contributes.panels.map((panel) => ({
          tab: pluginPanelTab(p.pluginKey, panel.id),
          pluginKey: p.pluginKey,
          pluginName: p.manifest!.name,
          id: panel.id,
          title: panel.title,
          ...(panel.icon ? { icon: panel.icon } : {})
        }))
      )
      panelCache = { from: state.snapshot, panels: panels.length ? panels : NO_PANELS }
    }
    return panelCache.panels
  })
}

let registered: { ids: string[]; dispose: (() => void)[] } = { ids: [], dispose: [] }

function applyContributions(snapshot: PluginsSnapshot): void {
  for (const dispose of registered.dispose) dispose()
  unregisterKeybindingDefinitions(registered.ids)
  const ids: string[] = []
  const dispose: (() => void)[] = []
  const definitions = []
  for (const plugin of enabledPlugins({ status: 'ready', snapshot, error: null })) {
    const manifest = plugin.manifest!
    for (const command of manifest.contributes.commands) {
      if (!command.action || !ALIASABLE_ACTIONS.has(command.action)) continue
      const id = pluginCommandId(plugin.pluginKey, command.id)
      const action = command.action
      const keys = manifest.contributes.keybindings.filter((k) => k.command === command.id).map((k) => k.key)
      definitions.push({ id, title: `${manifest.name}: ${command.title}`, group: 'Plugins', keywords: [manifest.name, 'plugin'], defaultBindings: keys })
      ids.push(id)
      // Returning false lets the key through when the aliased surface is not there.
      dispose.push(registerCommandHandler(id, () => runCommand(action)))
    }
  }
  registerKeybindingDefinitions(definitions)
  registered = { ids, dispose }
}

function apply(snapshot: PluginsSnapshot): void {
  store.set({ status: 'ready', snapshot, error: null })
  applyContributions(snapshot)
}

export async function loadPlugins(): Promise<void> {
  store.update((s) => ({ ...s, status: 'loading' }))
  try {
    apply(await harnessRequest(HARNESS_METHODS.pluginsList, {}, LOCAL_HOST))
  } catch (error) {
    store.update((s) => ({ ...s, status: 'failed', error: error instanceof Error ? error.message : String(error) }))
  }
}

export async function setPluginEnabled(plugin: PluginListEntry, enabled: boolean): Promise<void> {
  apply(
    await harnessRequest(
      HARNESS_METHODS.pluginSetEnabled,
      { pluginKey: plugin.pluginKey, enabled, ...(enabled && plugin.consentFingerprint ? { consentFingerprint: plugin.consentFingerprint } : {}) },
      LOCAL_HOST
    )
  )
}

/** Loads plugins whenever this computer's daemon (re)connects. */
export function usePluginBootstrap(): void {
  const connected = useStore((s) => s.hosts[LOCAL_HOST]?.connection.kind === 'connected')
  useEffect(() => {
    if (connected) void loadPlugins()
  }, [connected])
}
