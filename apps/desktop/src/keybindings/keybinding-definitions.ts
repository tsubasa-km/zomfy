import { IS_MAC } from './keybinding-chords'

// Command catalogue for the shortcuts editor, the command palette and the key dispatcher.
// Ids, titles and defaults follow Orca's registry (shared/keybindings/definitions-core-*.ts)
// where Orca has the command; the harness additions keep its existing chords.

export interface KeybindingDefinition {
  id: string
  title: string
  /** Section in the shortcuts editor and palette (Orca's groups: Global, Tabs, Editors…). */
  group: string
  keywords?: readonly string[]
  /** One list for every platform, or separate macOS / Windows+Linux lists. */
  defaultBindings: readonly string[] | { mac: readonly string[]; other: readonly string[] }
  /** Keeps working inside a terminal under the terminal-first shortcut policy. */
  allowInTerminal?: boolean
  /** The binding's trailing 1 stands for 1–9; the handler receives the 0-based index. */
  digitIndex?: boolean
  /** Hidden from the command palette (digit-index commands need a key to mean anything). */
  hideInPalette?: boolean
}

const APP_DEFINITIONS: KeybindingDefinition[] = [
  { id: 'app.quickOpen', title: 'Go to File', group: 'Global', keywords: ['file', 'quick open', 'find'], defaultBindings: ['Mod+P'] },
  {
    id: 'app.commandPalette',
    title: 'Command Palette',
    group: 'Global',
    keywords: ['commands', 'palette', 'switch', 'jump', 'workspace'],
    defaultBindings: ['Mod+Shift+P', 'Mod+J']
  },
  { id: 'app.settings', title: 'Open Settings', group: 'Global', keywords: ['settings', 'preferences'], defaultBindings: ['Mod+Comma'] },
  { id: 'app.shortcuts', title: 'Open Keyboard Shortcuts', group: 'Global', keywords: ['keybindings', 'shortcuts', 'keys'], defaultBindings: [] },
  { id: 'app.forceReload', title: 'Force Reload', group: 'Global', keywords: ['reload', 'refresh'], defaultBindings: ['Mod+Shift+R'] },
  {
    id: 'workspace.navigateUp',
    title: 'Previous workspace',
    group: 'Global',
    keywords: ['workspace', 'worktree', 'previous', 'up'],
    defaultBindings: ['Mod+Shift+ArrowUp'],
    allowInTerminal: true
  },
  {
    id: 'workspace.navigateDown',
    title: 'Next workspace',
    group: 'Global',
    keywords: ['workspace', 'worktree', 'next', 'down'],
    defaultBindings: ['Mod+Shift+ArrowDown'],
    allowInTerminal: true
  },
  {
    id: 'workspace.selectByIndex',
    title: 'Select Workspace 1–9',
    group: 'Global',
    keywords: ['workspace', 'worktree', 'number', 'jump'],
    defaultBindings: ['Mod+1'],
    digitIndex: true,
    hideInPalette: true
  },
  {
    id: 'agent.jumpToNeedsYou',
    title: 'Jump to agent that needs you',
    group: 'Global',
    keywords: ['agent', 'attention', 'waiting', 'permission', 'needs you'],
    defaultBindings: ['Mod+Alt+J'],
    allowInTerminal: true
  },
  {
    id: 'dashboard.toggle',
    title: 'Toggle Agent Dashboard',
    group: 'Global',
    keywords: ['agents', 'dashboard', 'overview'],
    defaultBindings: ['Mod+Shift+D'],
    allowInTerminal: true
  },
  {
    id: 'floatingWorkspace.toggle',
    title: 'Toggle Floating Workspace',
    group: 'Global',
    keywords: ['floating', 'terminal', 'panel'],
    defaultBindings: ['Mod+Alt+A'],
    allowInTerminal: true
  },
  { id: 'sidebar.right.toggle', title: 'Toggle Right Sidebar', group: 'Global', keywords: ['sidebar', 'panel'], defaultBindings: ['Mod+L'] },
  { id: 'sidebar.explorer.toggle', title: 'Show Explorer', group: 'Global', keywords: ['files', 'tree'], defaultBindings: ['Mod+Shift+E'], allowInTerminal: true },
  { id: 'sidebar.search.toggle', title: 'Show Search', group: 'Global', keywords: ['find', 'grep'], defaultBindings: ['Mod+Shift+F'], allowInTerminal: true },
  {
    id: 'sidebar.sourceControl.toggle',
    title: 'Show Source Control',
    group: 'Global',
    keywords: ['git', 'changes', 'diff', 'commit'],
    defaultBindings: ['Mod+Shift+G'],
    allowInTerminal: true
  },
  { id: 'statusBar.toggle', title: 'Toggle Status Bar', group: 'Global', keywords: ['status bar', 'footer'], defaultBindings: [] },
  { id: 'zoom.in', title: 'Zoom In', group: 'Global', keywords: ['zoom', 'bigger', 'scale'], defaultBindings: ['Mod+Equal', 'Mod+Shift+Plus', 'Mod+NumpadAdd'] },
  { id: 'zoom.out', title: 'Zoom Out', group: 'Global', keywords: ['zoom', 'smaller', 'scale'], defaultBindings: ['Mod+Minus', 'Mod+NumpadSubtract'] },
  { id: 'zoom.reset', title: 'Reset Size', group: 'Global', keywords: ['zoom', 'actual size', 'reset'], defaultBindings: ['Mod+0'] },
  { id: 'theme.system', title: 'Theme: Use System Setting', group: 'Appearance', keywords: ['theme', 'auto'], defaultBindings: [] },
  { id: 'theme.dark', title: 'Theme: Dark', group: 'Appearance', keywords: ['theme', 'dark mode'], defaultBindings: [] },
  { id: 'theme.light', title: 'Theme: Light', group: 'Appearance', keywords: ['theme', 'light mode'], defaultBindings: [] },
  {
    id: 'settings.search',
    title: 'Search Settings',
    group: 'Settings',
    keywords: ['settings', 'find'],
    defaultBindings: ['Mod+F'],
    hideInPalette: true
  }
]

const definitions: KeybindingDefinition[] = [...APP_DEFINITIONS]
const listeners = new Set<() => void>()
let snapshot: readonly KeybindingDefinition[] = definitions.slice()

/** Every known command, in editor/palette order. Stable between registrations. */
export function keybindingDefinitions(): readonly KeybindingDefinition[] {
  return snapshot
}

export function findKeybindingDefinition(id: string): KeybindingDefinition | undefined {
  return snapshot.find((d) => d.id === id)
}

/**
 * Adds an area's commands (tabs, terminal, editor…) at module load. Re-registering an id
 * replaces it, so hot reload does not duplicate rows.
 */
export function registerKeybindingDefinitions(added: readonly KeybindingDefinition[]): void {
  for (const definition of added) {
    const index = definitions.findIndex((d) => d.id === definition.id)
    if (index === -1) definitions.push(definition)
    else definitions[index] = definition
  }
  snapshot = definitions.slice()
  for (const listener of listeners) listener()
}

export function subscribeKeybindingDefinitions(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function defaultBindingsFor(definition: KeybindingDefinition): readonly string[] {
  const d = definition.defaultBindings
  return 'mac' in d ? (IS_MAC ? d.mac : d.other) : d
}
