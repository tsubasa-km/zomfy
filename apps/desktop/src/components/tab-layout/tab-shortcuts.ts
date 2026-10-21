// Tab shortcuts with Orca's default bindings (shared/keybindings/definitions-core-2.ts). Kept as a
// table of action ids so the app-level keybinding registry can take them over.

export const isMac = typeof navigator !== 'undefined' && navigator.userAgent.includes('Mac')

export type TabShortcutAction =
  | 'tab.close'
  | 'tab.reopenClosed'
  | 'tab.nextAllTypes'
  | 'tab.previousAllTypes'
  | 'tab.newBrowser'
  | 'tab.rename'
  | 'tab.selectByIndex'
  | 'tab.recentSwitcher'

interface Chord {
  mod?: boolean
  ctrl?: boolean
  shift?: boolean
  alt?: boolean
  code: string | RegExp
}

const BINDINGS: Record<TabShortcutAction, Chord | null> = {
  'tab.close': { mod: true, code: 'KeyW' },
  'tab.reopenClosed': { mod: true, shift: true, code: 'KeyT' },
  'tab.nextAllTypes': { mod: true, shift: true, code: 'BracketRight' },
  'tab.previousAllTypes': { mod: true, shift: true, code: 'BracketLeft' },
  'tab.newBrowser': { mod: true, shift: true, code: 'KeyB' },
  // Why: macOS only — Ctrl+R is the shell's reverse search elsewhere (Orca leaves it unbound).
  'tab.rename': isMac ? { mod: true, code: 'KeyR' } : null,
  // Why: Mod+1-9 jumps between workspaces, so tabs take Ctrl (macOS) or Alt.
  'tab.selectByIndex': isMac ? { ctrl: true, code: /^Digit[1-9]$/ } : { alt: true, code: /^Digit[1-9]$/ },
  // Shift reverses direction; matched separately because it is held through the gesture.
  'tab.recentSwitcher': { ctrl: true, code: 'Tab' }
}

function matches(event: KeyboardEvent, chord: Chord): boolean {
  const wantCtrl = chord.ctrl || (chord.mod && !isMac)
  const wantMeta = chord.mod && isMac
  const code = typeof chord.code === 'string' ? event.code === chord.code : chord.code.test(event.code)
  return (
    code &&
    event.ctrlKey === Boolean(wantCtrl) &&
    event.metaKey === Boolean(wantMeta) &&
    event.altKey === Boolean(chord.alt) &&
    (chord.code === 'Tab' || event.shiftKey === Boolean(chord.shift))
  )
}

export function matchTabShortcut(event: KeyboardEvent): TabShortcutAction | null {
  for (const [action, chord] of Object.entries(BINDINGS) as [TabShortcutAction, Chord | null][]) {
    if (chord && matches(event, chord)) return action
  }
  return null
}

const KEY_LABELS: Record<string, string> = { BracketRight: ']', BracketLeft: '[', Tab: 'Tab' }

export function shortcutLabel(action: TabShortcutAction): string {
  const chord = BINDINGS[action]
  if (!chord || typeof chord.code !== 'string') return ''
  const key = KEY_LABELS[chord.code] ?? chord.code.replace(/^Key|^Digit/, '')
  const parts: string[] = []
  if (isMac) {
    if (chord.ctrl) parts.push('⌃')
    if (chord.alt) parts.push('⌥')
    if (chord.shift) parts.push('⇧')
    if (chord.mod) parts.push('⌘')
    return parts.join('') + key
  }
  if (chord.ctrl || chord.mod) parts.push('Ctrl')
  if (chord.alt) parts.push('Alt')
  if (chord.shift) parts.push('Shift')
  return [...parts, key].join('+')
}
