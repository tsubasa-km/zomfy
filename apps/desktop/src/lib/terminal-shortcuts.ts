// Terminal-scoped chords from Orca's keybindings: platform-native clipboard keys, and Mod+F/Mod+K.
// Mac uses Cmd; Windows and Linux use Ctrl, with Shift on the chords a shell needs bare.

export const isMac = navigator.userAgent.includes('Mac')

export type TerminalShortcutAction = 'copy' | 'paste' | 'selectAll' | 'search' | 'clear'

export function matchTerminalShortcut(e: KeyboardEvent, hasSelection: boolean): TerminalShortcutAction | null {
  if (e.type !== 'keydown' || e.altKey) return null
  const key = e.code
  if (isMac) {
    if (!e.metaKey || e.ctrlKey) return null
    if (key === 'KeyC' && !e.shiftKey) return hasSelection ? 'copy' : null
    if (key === 'KeyV' && !e.shiftKey) return 'paste'
    if (key === 'KeyA' && !e.shiftKey) return 'selectAll'
    if (key === 'KeyF' && !e.shiftKey) return 'search'
    if (key === 'KeyK' && !e.shiftKey) return 'clear'
    return null
  }
  if (key === 'Insert' && e.shiftKey && !e.ctrlKey) return 'paste'
  if (!e.ctrlKey || e.metaKey) return null
  if (key === 'KeyC') return e.shiftKey || hasSelection ? 'copy' : null
  if (key === 'KeyV') return 'paste'
  if (key === 'KeyA' && e.shiftKey) return 'selectAll'
  if (key === 'KeyF' && !e.shiftKey) return 'search'
  if (key === 'KeyK' && !e.shiftKey) return 'clear'
  return null
}

export const TERMINAL_SHORTCUT_LABELS: Record<TerminalShortcutAction, string> = isMac
  ? { copy: '⌘C', paste: '⌘V', selectAll: '⌘A', search: '⌘F', clear: '⌘K' }
  : { copy: 'Ctrl+Shift+C', paste: 'Ctrl+V', selectAll: 'Ctrl+Shift+A', search: 'Ctrl+F', clear: 'Ctrl+K' }

export const SUBMIT_SHORTCUT_LABEL = isMac ? '⌘↵' : 'Ctrl+↵'

export function isSubmitShortcut(e: { key: string; metaKey: boolean; ctrlKey: boolean }): boolean {
  return e.key === 'Enter' && (isMac ? e.metaKey : e.ctrlKey)
}
