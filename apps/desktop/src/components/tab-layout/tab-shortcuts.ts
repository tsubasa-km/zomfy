import { matchChord } from '@/keybindings/keybinding-chords'
import { findKeybindingDefinition } from '@/keybindings/keybinding-definitions'
import { effectiveBindings, shortcutLabel as registryShortcutLabel } from '@/keybindings/keybinding-registry'

// Tab shortcuts, defined in the app keybinding registry (keybindings/keybinding-definitions.ts) with
// Orca's defaults, so they show in the shortcuts editor and follow the user's rebindings.
// use-tab-keyboard.tsx matches them itself because the recent-tab switcher needs key-up handling.

export type TabShortcutAction =
  | 'tab.close'
  | 'tab.reopenClosed'
  | 'tab.nextAllTypes'
  | 'tab.previousAllTypes'
  | 'tab.newBrowser'
  | 'tab.rename'
  | 'tab.selectByIndex'
  | 'tab.recentSwitcher'

const ACTIONS: readonly TabShortcutAction[] = [
  'tab.close',
  'tab.reopenClosed',
  'tab.nextAllTypes',
  'tab.previousAllTypes',
  'tab.newBrowser',
  'tab.rename',
  'tab.selectByIndex',
  'tab.recentSwitcher'
]

export function matchTabShortcut(event: KeyboardEvent): TabShortcutAction | null {
  for (const action of ACTIONS) {
    const definition = findKeybindingDefinition(action)
    if (!definition) continue
    for (const binding of effectiveBindings(definition)) {
      // Shift is held through the recent-tab gesture to reverse it, so match either way.
      const probe =
        action === 'tab.recentSwitcher' && event.shiftKey && !/Shift/.test(binding)
          ? { code: event.code, key: event.key, metaKey: event.metaKey, ctrlKey: event.ctrlKey, altKey: event.altKey, shiftKey: false }
          : event
      if (matchChord(probe, binding, definition.digitIndex) !== null) return action
    }
  }
  return null
}

export function shortcutLabel(action: TabShortcutAction): string {
  return registryShortcutLabel(action) ?? ''
}
