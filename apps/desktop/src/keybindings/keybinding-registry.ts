import { useEffect, useRef, useSyncExternalStore } from 'react'
import { getSetting, useSetting } from '@/stores/settings-store'
import { formatChord, formatChordLabel, matchChord } from './keybinding-chords'
import {
  defaultBindingsFor,
  findKeybindingDefinition,
  keybindingDefinitions,
  subscribeKeybindingDefinitions,
  type KeybindingDefinition
} from './keybinding-definitions'

/** Return false to let the key press through (the command did not apply here). */
export type CommandHandler = (context: { index: number }) => void | boolean

const handlers = new Map<string, CommandHandler[]>()
const handlerListeners = new Set<() => void>()
let handlerVersion = 0

function notifyHandlers(): void {
  handlerVersion++
  for (const listener of handlerListeners) listener()
}

/** The newest registration wins, so a focused surface can shadow the app-wide handler. */
export function registerCommandHandler(id: string, handler: CommandHandler): () => void {
  handlers.set(id, [...(handlers.get(id) ?? []), handler])
  notifyHandlers()
  return () => {
    handlers.set(id, (handlers.get(id) ?? []).filter((h) => h !== handler))
    notifyHandlers()
  }
}

/** Registers a handler while the component is mounted (and `enabled`), always calling the latest closure. */
export function useCommandHandler(id: string, handler: CommandHandler, enabled = true): void {
  const latest = useRef(handler)
  latest.current = handler
  useEffect(() => {
    if (!enabled) return
    return registerCommandHandler(id, (context) => latest.current(context))
  }, [id, enabled])
}

export function hasCommandHandler(id: string): boolean {
  return (handlers.get(id)?.length ?? 0) > 0
}

/** Runs a command as if its shortcut were pressed; false when nothing handles it. */
export function runCommand(id: string, index = 0): boolean {
  const handler = handlers.get(id)?.at(-1)
  if (!handler) return false
  return handler({ index }) !== false
}

subscribeKeybindingDefinitions(notifyHandlers)

/** Re-renders when handlers or definitions change (the palette lists what can run now). */
export function useCommandRegistryVersion(): number {
  return useSyncExternalStore(
    (listener) => {
      handlerListeners.add(listener)
      return () => handlerListeners.delete(listener)
    },
    () => handlerVersion
  )
}

export function effectiveBindings(
  definition: KeybindingDefinition,
  overrides: Record<string, string[]> = getSetting('keybindings')
): readonly string[] {
  return overrides[definition.id] ?? defaultBindingsFor(definition)
}

export function effectiveBindingsFor(id: string, overrides?: Record<string, string[]>): readonly string[] {
  const definition = findKeybindingDefinition(id)
  return definition ? effectiveBindings(definition, overrides) : []
}

const EMPTY: readonly string[] = []

/** The command's current chords, following user overrides. */
export function useEffectiveBindings(id: string): readonly string[] {
  const overrides = useSetting('keybindings')
  useCommandRegistryVersion()
  const definition = findKeybindingDefinition(id)
  return definition ? effectiveBindings(definition, overrides) : EMPTY
}

/** First chord as text (`⌘⇧P` / `Ctrl+Shift+P`) for tooltips and menus; null when unbound. */
export function useShortcutLabel(id: string): string | null {
  const first = useEffectiveBindings(id)[0]
  return first ? formatChordLabel(first) : null
}

/** First chord as key caps, for <ShortcutKeyCombo>. */
export function useShortcutKeys(id: string): string[] | null {
  const first = useEffectiveBindings(id)[0]
  return first ? formatChord(first) : null
}

export function shortcutLabel(id: string): string | null {
  const first = effectiveBindingsFor(id)[0]
  return first ? formatChordLabel(first) : null
}

function isComposing(event: KeyboardEvent): boolean {
  return event.isComposing || event.keyCode === 229
}

/**
 * One capture-phase keydown listener for every registered command, so app shortcuts run before
 * a focused terminal, editor or a component's own bubble-phase listener sees the key.
 */
export function installKeybindingDispatcher(): () => void {
  function onKeyDown(event: KeyboardEvent): void {
    if (event.defaultPrevented || isComposing(event)) return
    const target = event.target instanceof Element ? event.target : null
    // The shortcuts editor records chords; it must see every key itself.
    if (target?.closest('[data-shortcut-recorder-active]')) return
    const inTerminal = !!target?.closest('.xterm')
    const terminalFirst = getSetting('terminalShortcutPolicy') === 'terminal-first'
    const overrides = getSetting('keybindings')
    for (const definition of keybindingDefinitions()) {
      if (!hasCommandHandler(definition.id)) continue
      if (inTerminal && terminalFirst && !definition.allowInTerminal) continue
      for (const binding of effectiveBindings(definition, overrides)) {
        const index = matchChord(event, binding, definition.digitIndex)
        if (index === null) continue
        if (runCommand(definition.id, index)) {
          event.preventDefault()
          event.stopPropagation()
        }
        return
      }
    }
  }
  window.addEventListener('keydown', onKeyDown, true)
  return () => window.removeEventListener('keydown', onKeyDown, true)
}
