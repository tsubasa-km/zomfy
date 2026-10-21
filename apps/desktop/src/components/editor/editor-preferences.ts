import { useSyncExternalStore } from 'react'

/** Orca keeps these in app settings; here they are per-window view preferences. */
export interface EditorPreferences {
  /** Orca: undefined/true mean wrap on (#9974). */
  editorWordWrap: boolean
  editorMinimap: boolean
  diffSideBySide: boolean
  diffWordWrap: boolean
  diffShowWhitespace: boolean
  diffCollapseUnchangedRegions: boolean
  markdownViewMode: MarkdownViewMode
}

export type MarkdownViewMode = 'source' | 'split' | 'preview'

const STORAGE_KEY = 'acp-harness.editor-preferences'
const DEFAULTS: EditorPreferences = {
  editorWordWrap: true,
  editorMinimap: false,
  diffSideBySide: true,
  diffWordWrap: false,
  diffShowWhitespace: false,
  diffCollapseUnchangedRegions: false,
  markdownViewMode: 'preview'
}

function read(): EditorPreferences {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null')
    return saved && typeof saved === 'object' ? { ...DEFAULTS, ...saved } : DEFAULTS
  } catch {
    return DEFAULTS
  }
}

let current = read()
const listeners = new Set<() => void>()

export function updateEditorPreferences(patch: Partial<EditorPreferences>): void {
  current = { ...current, ...patch }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(current))
  } catch {
    // Storage can be unavailable; the preference still applies for this window.
  }
  for (const listener of listeners) listener()
}

export function useEditorPreferences(): EditorPreferences {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => current
  )
}
