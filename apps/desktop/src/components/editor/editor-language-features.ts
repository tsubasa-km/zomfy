import type { OnMount } from '@monaco-editor/react'
import type { EditorTab } from '@/session-store'

// What a language adds to a file's editor beyond Monaco's own highlighting: completion, hovers,
// diagnostics, formatting. The text editor calls this once per mounted editor and calls the
// returned function when the editor goes away.

type MonacoEditor = Parameters<OnMount>[0]

export function attachLanguageFeatures(_editor: MonacoEditor, _tab: EditorTab): () => void {
  return () => undefined
}
