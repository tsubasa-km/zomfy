// Chord strings follow Orca's keybinding grammar (shared/keybindings, MIT): `Mod+Shift+P`, where
// `Mod` is ⌘ on macOS and Ctrl elsewhere, and the key token names a physical key (`P`, `1`,
// `Equal`, `ArrowUp`, `F5`), so bindings survive keyboard layouts the way KeyboardEvent.code does.

export const IS_MAC = navigator.userAgent.includes('Mac')

interface ParsedChord {
  meta: boolean
  ctrl: boolean
  alt: boolean
  shift: boolean
  key: string
}

const cache = new Map<string, ParsedChord | null>()

/** Resolves `Mod` for this platform; null for malformed chords. */
export function parseChord(binding: string): ParsedChord | null {
  const cached = cache.get(binding)
  if (cached !== undefined) return cached
  const tokens = binding.split('+')
  // `Mod+Plus` and a bare `+` key both end in an empty token after split.
  const key = tokens.at(-1) === '' ? 'Plus' : tokens.at(-1)
  const chord: ParsedChord = { meta: false, ctrl: false, alt: false, shift: false, key: key ?? '' }
  let valid = chord.key !== ''
  for (const token of tokens.slice(0, tokens.at(-1) === '' ? -2 : -1)) {
    switch (token) {
      case 'Mod':
        if (IS_MAC) chord.meta = true
        else chord.ctrl = true
        break
      case 'Cmd':
      case 'Meta':
        chord.meta = true
        break
      case 'Ctrl':
        chord.ctrl = true
        break
      case 'Alt':
      case 'Option':
        chord.alt = true
        break
      case 'Shift':
        chord.shift = true
        break
      default:
        valid = false
    }
  }
  const result = valid ? chord : null
  cache.set(binding, result)
  return result
}

const MODIFIER_CODES = new Set([
  'ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight', 'AltLeft', 'AltRight',
  'MetaLeft', 'MetaRight', 'OSLeft', 'OSRight', 'CapsLock', 'Fn', 'FnLock'
])

/** `KeyP` → `P`, `Digit1` → `1`, everything else keeps its code name; null for modifier keys. */
export function keyTokenFromCode(code: string): string | null {
  if (!code || MODIFIER_CODES.has(code)) return null
  if (/^Key[A-Z]$/.test(code)) return code.slice(3)
  if (/^Digit\d$/.test(code)) return code.slice(5)
  return code
}

type KeyEventLike = Pick<KeyboardEvent, 'code' | 'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'>

/**
 * Whether the event is this chord. For digit-index commands (Orca's "Select Workspace 1–9")
 * a trailing 1 stands for any of 1–9, and the result is the 0-based digit index.
 */
export function matchChord(event: KeyEventLike, binding: string, digitIndex = false): number | null {
  const chord = parseChord(binding)
  if (!chord) return null
  if (
    event.metaKey !== chord.meta ||
    event.ctrlKey !== chord.ctrl ||
    event.altKey !== chord.alt ||
    event.shiftKey !== chord.shift
  ) {
    return null
  }
  const token = keyTokenFromCode(event.code)
  if (digitIndex && /^[1-9]$/.test(chord.key)) {
    const digit = /^(?:Digit|Numpad)([1-9])$/.exec(event.code)?.[1]
    return digit ? Number(digit) - 1 : null
  }
  if (chord.key === 'Plus') return event.key === '+' ? 0 : null
  if (token === chord.key) return 0
  // Numpad digits act like the top row (Ctrl+Numpad0 resets zoom, as in browsers).
  if (/^\d$/.test(chord.key) && event.code === `Numpad${chord.key}`) return 0
  return null
}

/** The chord a key press records, as the shortcuts editor stores it; null for modifier-only or bare keys. */
export function chordFromEvent(event: KeyEventLike): string | null {
  const token = keyTokenFromCode(event.code)
  if (!token) return null
  const parts: string[] = []
  if (IS_MAC ? event.metaKey : event.ctrlKey) parts.push('Mod')
  if (IS_MAC && event.ctrlKey) parts.push('Ctrl')
  if (!IS_MAC && event.metaKey) parts.push('Cmd')
  if (event.altKey) parts.push('Alt')
  if (event.shiftKey) parts.push('Shift')
  const hasCommandModifier = parts.some((p) => p !== 'Shift')
  // Like Orca, bare keys would swallow typing; only function keys may stand alone.
  if (!hasCommandModifier && !/^F\d{1,2}$/.test(token)) return null
  return [...parts, token].join('+')
}

const KEY_LABELS: Record<string, string> = {
  BracketLeft: '[',
  BracketRight: ']',
  Minus: '-',
  Equal: '=',
  Plus: '+',
  ArrowLeft: '←',
  ArrowRight: '→',
  ArrowUp: '↑',
  ArrowDown: '↓',
  NumpadAdd: 'Numpad +',
  NumpadSubtract: 'Numpad -',
  Comma: ',',
  Period: '.',
  Slash: '/',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Backquote: '`',
  Escape: 'Esc'
}

/** Key caps for display, Orca's glyphs on macOS (⌘ ⌃ ⌥ ⇧) and words elsewhere. */
export function formatChord(binding: string): string[] {
  const chord = parseChord(binding)
  if (!chord) return [binding]
  const parts: string[] = []
  if (IS_MAC) {
    if (chord.meta) parts.push('⌘')
    if (chord.ctrl) parts.push('⌃')
    if (chord.alt) parts.push('⌥')
    if (chord.shift) parts.push('⇧')
  } else {
    if (chord.ctrl) parts.push('Ctrl')
    if (chord.meta) parts.push('Cmd')
    if (chord.alt) parts.push('Alt')
    if (chord.shift) parts.push('Shift')
  }
  parts.push(IS_MAC && chord.key === 'Backspace' ? '⌫' : (KEY_LABELS[chord.key] ?? chord.key))
  return parts
}

/** One-line label: `⌘⇧P` on macOS, `Ctrl+Shift+P` elsewhere. */
export function formatChordLabel(binding: string): string {
  return formatChord(binding).join(IS_MAC ? '' : '+')
}
