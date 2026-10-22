import { Bell, BookOpen, Bot, Blocks, Keyboard, Palette, Server, SlidersHorizontal, SquareTerminal, TextCursorInput, type LucideIcon } from 'lucide-react'

// Orca's settings sidebar groups and sections (hooks/settings-navigation-*-sections.ts), trimmed
// to what the harness has. Search entries mirror each pane's rows so search finds a setting.

export interface SettingsSearchEntry {
  title: string
  description?: string
  keywords?: readonly string[]
}

export interface SettingsNavSection {
  id: string
  title: string
  description: string
  icon: LucideIcon
  group: string
  entries: readonly SettingsSearchEntry[]
}

export const SETTINGS_NAV_GROUPS = [
  { id: 'capabilities', title: 'AI Capabilities' },
  { id: 'setup', title: 'Set Up' },
  { id: 'workflows', title: 'Workflows' },
  { id: 'interface', title: 'Interface' },
  { id: 'remote', title: 'Remote Hosts' }
] as const

export const SETTINGS_SECTIONS: readonly SettingsNavSection[] = [
  {
    id: 'agents',
    title: 'Agents',
    description: 'Manage AI agents, set a default, and customize commands.',
    icon: Bot,
    group: 'capabilities',
    entries: [
      { title: 'Default agent', keywords: ['claude', 'agent'] },
      { title: 'Claude Code command', description: 'CLI each host runs for agent turns.', keywords: ['claude', 'path', 'executable', 'cli'] }
    ]
  },
  {
    id: 'skills',
    title: 'Skills',
    description: 'Browse the agent skills on each host.',
    icon: BookOpen,
    group: 'capabilities',
    entries: [
      { title: 'Open Skills', keywords: ['skills', 'SKILL.md', 'browse'] },
      { title: 'Show Skills in sidebar', keywords: ['skills', 'sidebar', 'button'] }
    ]
  },
  {
    id: 'plugins',
    title: 'Plugins',
    description: 'Panels and commands from plugin folders on this computer.',
    icon: Blocks,
    group: 'capabilities',
    entries: [
      { title: 'Plugins folder', keywords: ['plugin', 'install', 'folder', 'orca-plugin.json'] },
      { title: 'Installed plugins', keywords: ['plugin', 'enable', 'disable', 'panel', 'command'] }
    ]
  },
  {
    id: 'general',
    title: 'General',
    description: 'Workspace defaults, app setup, and maintenance.',
    icon: SlidersHorizontal,
    group: 'setup',
    entries: [
      { title: 'Group workspaces by', keywords: ['sidebar', 'project', 'status'] },
      { title: 'Sort workspaces by', keywords: ['sidebar', 'name', 'recent', 'created'] },
      { title: 'Status bar', keywords: ['footer', 'status bar'] },
      { title: 'Minimize to Tray on Close', keywords: ['tray', 'minimize', 'close', 'background'] },
      { title: 'Run setup again', keywords: ['onboarding', 'welcome', 'first run', 'setup'] },
      { title: 'Reset all settings', keywords: ['defaults', 'restore'] }
    ]
  },
  {
    id: 'terminal',
    title: 'Terminal',
    description: 'Shells, renderer, sessions, and terminal behavior.',
    icon: SquareTerminal,
    group: 'workflows',
    entries: [
      { title: 'Scrollback', keywords: ['history', 'lines', 'buffer'] },
      { title: 'Shortcuts in Terminal', keywords: ['shortcut', 'priority', 'policy', 'keybindings'] },
      { title: 'Default shell', keywords: ['shell', 'powershell', 'bash', 'zsh', 'cmd'] }
    ]
  },
  {
    id: 'appearance',
    title: 'Appearance',
    description: 'Theme, zoom, app and terminal appearance, and status bar.',
    icon: Palette,
    group: 'interface',
    entries: [
      { title: 'Theme', keywords: ['dark', 'light', 'system', 'color'] },
      { title: 'UI Zoom', keywords: ['zoom', 'scale', 'size'] },
      { title: 'IDE Font', keywords: ['font', 'typeface', 'typography'] },
      { title: 'Terminal Font', keywords: ['font', 'terminal', 'monospace'] },
      { title: 'Terminal Font Size', keywords: ['font size', 'terminal'] },
      { title: 'Line Height', keywords: ['terminal', 'spacing'] },
      { title: 'Cursor Style', keywords: ['cursor', 'block', 'bar', 'underline'] },
      { title: 'Blinking Cursor', keywords: ['cursor', 'blink'] }
    ]
  },
  {
    id: 'input',
    title: 'Input & Editing',
    description: 'Selection and editing behavior.',
    icon: TextCursorInput,
    group: 'interface',
    entries: [
      { title: 'Editor Font', keywords: ['editor', 'font', 'monaco'] },
      { title: 'Editor Font Size', keywords: ['editor', 'font size'] },
      { title: 'Word Wrap', keywords: ['editor', 'wrap'] },
      { title: 'Minimap', keywords: ['editor', 'minimap', 'overview'] }
    ]
  },
  {
    id: 'notifications',
    title: 'Notifications',
    description: 'Native desktop notifications for agent and terminal events.',
    icon: Bell,
    group: 'interface',
    entries: [
      { title: 'Enable notifications', keywords: ['notify', 'desktop', 'alert'] },
      { title: 'Agent finished', keywords: ['done', 'complete', 'turn'] },
      { title: 'Agent needs you', keywords: ['permission', 'approval', 'attention'] },
      { title: 'Suppress while focused', keywords: ['focus', 'quiet'] }
    ]
  },
  {
    id: 'shortcuts',
    title: 'Shortcuts',
    description: 'Keyboard shortcuts for common actions.',
    icon: Keyboard,
    group: 'interface',
    entries: [{ title: 'Keyboard Shortcuts', keywords: ['keybindings', 'keys', 'hotkeys', 'shortcut'] }]
  },
  {
    id: 'hosts',
    title: 'Hosts',
    description: 'This computer, WSL distros and SSH hosts: connection state and per-host settings.',
    icon: Server,
    group: 'remote',
    entries: [
      { title: 'Connection', keywords: ['daemon', 'wsl', 'ssh', 'remote', 'tunnel', 'connected', 'offline'] },
      { title: 'Default shell', keywords: ['shell'] }
    ]
  }
]

function normalize(text: string): string {
  return text.toLowerCase().trim()
}

/** Orca's settings search: every word of the query must appear in the title, description or keywords. */
export function matchesSettingsSearch(query: string, entry: SettingsSearchEntry): boolean {
  const words = normalize(query).split(/\s+/).filter(Boolean)
  if (words.length === 0) return true
  const haystack = normalize([entry.title, entry.description ?? '', ...(entry.keywords ?? [])].join(' '))
  return words.every((word) => haystack.includes(word))
}

export function sectionMatchesSearch(query: string, section: SettingsNavSection): boolean {
  return (
    matchesSettingsSearch(query, { title: section.title, description: section.description }) ||
    section.entries.some((entry) => matchesSettingsSearch(query, entry))
  )
}
