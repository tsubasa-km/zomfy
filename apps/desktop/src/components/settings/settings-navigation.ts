import { Bell, BookOpen, Bot, Blocks, Keyboard, Mic, Palette, Server, SlidersHorizontal, SquareTerminal, TextCursorInput, type LucideIcon } from 'lucide-react'
import { t } from '@/i18n/i18n'

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
  { id: 'capabilities', title: t('AI Capabilities') },
  { id: 'setup', title: t('Set Up') },
  { id: 'workflows', title: t('Terminal') },
  { id: 'interface', title: t('Interface') },
  { id: 'remote', title: t('Remote Hosts') }
] as const

export const SETTINGS_SECTIONS: readonly SettingsNavSection[] = [
  {
    id: 'agents',
    title: t('Agents'),
    description: t('Manage AI agents, set a default, and customize commands.'),
    icon: Bot,
    group: 'capabilities',
    entries: [
      { title: t('Default agent'), keywords: ['claude', 'agent'] },
      { title: t('Claude Code command'), description: t('CLI each host runs for agent turns.'), keywords: ['claude', 'path', 'executable', 'cli'] }
    ]
  },
  {
    id: 'skills',
    title: t('Skills'),
    description: t('Browse the agent skills on each host.'),
    icon: BookOpen,
    group: 'capabilities',
    entries: [
      { title: t('Open Skills'), keywords: ['skills', 'SKILL.md', 'browse'] },
      { title: t('Show Skills in sidebar'), keywords: ['skills', 'sidebar', 'button'] }
    ]
  },
  {
    id: 'plugins',
    title: t('Plugins'),
    description: t('Panels and commands from plugin folders on this computer.'),
    icon: Blocks,
    group: 'capabilities',
    entries: [
      { title: t('Plugins folder'), keywords: ['plugin', 'install', 'folder', 'orca-plugin.json'] },
      { title: t('Installed plugins'), keywords: ['plugin', 'enable', 'disable', 'panel', 'command'] }
    ]
  },
  {
    id: 'general',
    title: t('General'),
    description: t('Workspace defaults, app setup, and maintenance.'),
    icon: SlidersHorizontal,
    group: 'setup',
    entries: [
      { title: t('Group workspaces by'), keywords: ['sidebar', 'project', 'status'] },
      { title: t('Sort workspaces by'), keywords: ['sidebar', 'name', 'recent', 'created'] },
      { title: t('Status bar'), keywords: ['footer', 'status bar'] },
      { title: t('Minimize to Tray on Close'), keywords: ['tray', 'minimize', 'close', 'background'] },
      { title: t('Language'), keywords: ['language', 'japanese', 'english', 'locale', '言語', '日本語'] },
      { title: t('Run setup again'), keywords: ['onboarding', 'welcome', 'first run', 'setup'] },
      { title: t('Take the tour'), keywords: ['tour', 'tutorial', 'guide', 'help', 'walkthrough'] },
      { title: t('Reset all settings'), keywords: ['defaults', 'restore'] }
    ]
  },
  {
    id: 'terminal',
    title: t('Terminal'),
    description: t('Shells, renderer, sessions, and terminal behavior.'),
    icon: SquareTerminal,
    group: 'workflows',
    entries: [
      { title: t('Scrollback'), keywords: ['history', 'lines', 'buffer'] },
      { title: t('Shortcuts in Terminal'), keywords: ['shortcut', 'priority', 'policy', 'keybindings'] },
      { title: t('Default shell'), keywords: ['shell', 'powershell', 'bash', 'zsh', 'cmd'] }
    ]
  },
  {
    id: 'appearance',
    title: t('Appearance'),
    description: t('Theme, zoom, sidebar rows, floating workspace, and terminal appearance.'),
    icon: Palette,
    group: 'interface',
    entries: [
      { title: t('Theme'), keywords: ['dark', 'light', 'system', 'color'] },
      { title: t('UI Zoom'), keywords: ['zoom', 'scale', 'size'] },
      { title: t('IDE Font'), keywords: ['font', 'typeface', 'typography'] },
      { title: t('Show Tasks Button'), keywords: ['tasks', 'sidebar', 'button', 'issues'] },
      { title: t('Show Automations Button'), keywords: ['automations', 'automation', 'schedule', 'sidebar'] },
      { title: t('Show Skills Button'), keywords: ['skills', 'sidebar', 'button'] },
      { title: t('Show Agent Dashboard Button'), keywords: ['dashboard', 'agents', 'sidebar'] },
      { title: t('Show Onboarding Checklist'), keywords: ['onboarding', 'setup', 'checklist', 'sidebar'] },
      { title: t('Enable Floating Workspace'), keywords: ['floating', 'workspace', 'terminal', 'quick panel'] },
      { title: t('Toggle Button Location'), keywords: ['floating', 'status bar', 'button'] },
      { title: t('Terminal Font'), keywords: ['font', 'terminal', 'monospace'] },
      { title: t('Terminal Font Size'), keywords: ['font size', 'terminal'] },
      { title: t('Line Height'), keywords: ['terminal', 'spacing'] },
      { title: t('Cursor Style'), keywords: ['cursor', 'block', 'bar', 'underline'] },
      { title: t('Blinking Cursor'), keywords: ['cursor', 'blink'] }
    ]
  },
  {
    id: 'input',
    title: t('Input & Editing'),
    description: t('Selection and editing behavior.'),
    icon: TextCursorInput,
    group: 'interface',
    entries: [
      { title: t('Editor Font'), keywords: ['editor', 'font', 'monaco'] },
      { title: t('Editor Font Size'), keywords: ['editor', 'font size'] },
      { title: t('Word Wrap'), keywords: ['editor', 'wrap'] },
      { title: t('Minimap'), keywords: ['editor', 'minimap', 'overview'] },
      { title: t('Send message with'), keywords: ['chat', 'composer', 'enter', 'ctrl', 'cmd', 'send', 'newline'] },
      { title: t('Experimental: chat memos'), keywords: ['chat', 'memo', 'notes', 'markdown', 'experimental'] }
    ]
  },
  {
    id: 'notifications',
    title: t('Notifications'),
    description: t('Native desktop notifications for agent and terminal events.'),
    icon: Bell,
    group: 'interface',
    entries: [
      { title: t('Enable notifications'), keywords: ['notify', 'desktop', 'alert'] },
      { title: t('Agent finished'), keywords: ['done', 'complete', 'turn'] },
      { title: t('Agent needs you'), keywords: ['permission', 'approval', 'attention'] },
      { title: t('Suppress while focused'), keywords: ['focus', 'quiet'] }
    ]
  },
  {
    id: 'voice',
    title: t('Voice'),
    description: t('Dictation in the chat composer.'),
    icon: Mic,
    group: 'interface',
    entries: [
      { title: t('Dictation'), keywords: ['voice', 'speech', 'microphone', 'dictate', 'whisper'] },
      { title: t('Transcription endpoint'), keywords: ['voice', 'whisper', 'url', 'openai', 'endpoint'] },
      { title: t('Model'), keywords: ['voice', 'whisper', 'model'] },
      { title: t('API key'), keywords: ['voice', 'key', 'token', 'openai'] },
      { title: t('Language'), keywords: ['voice', 'language', 'locale'] }
    ]
  },
  {
    id: 'shortcuts',
    title: t('Shortcuts'),
    description: t('Keyboard shortcuts for common actions.'),
    icon: Keyboard,
    group: 'interface',
    entries: [{ title: t('Keyboard Shortcuts'), keywords: ['keybindings', 'keys', 'hotkeys', 'shortcut'] }]
  },
  {
    id: 'hosts',
    title: t('Hosts'),
    description: t('This computer, WSL distros and SSH hosts: connection state and per-host settings.'),
    icon: Server,
    group: 'remote',
    entries: [
      { title: t('Connection'), keywords: ['daemon', 'wsl', 'ssh', 'remote', 'tunnel', 'connected', 'offline'] },
      { title: t('Default shell'), keywords: ['shell'] }
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
