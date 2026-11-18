import type { OnMount } from '@monaco-editor/react'
import type { EditorTab } from '@/session-store'
import { trackDocument } from '@/lib/lsp/lsp-documents'
import '@/lib/lsp/lsp-providers'
import '@/lib/lsp/lsp-workspace-edit'
import '@/lib/lsp/problems-feed'

// What a language adds to a file's editor beyond Monaco's own highlighting: completion, hovers,
// diagnostics, formatting. The text editor calls this once per mounted editor and calls the
// returned function when the editor goes away.
//
// The features come from language servers on the workspace's host (lib/lsp). They belong to the
// file's model rather than to this editor: the model keeps unsaved text while another tab shows, so
// its servers keep hearing about it until the model itself is disposed with its tab.

type MonacoEditor = Parameters<OnMount>[0]

export function attachLanguageFeatures(editor: MonacoEditor, tab: EditorTab): () => void {
  const model = editor.getModel()
  if (model) trackDocument(model, { workspaceId: tab.workspaceId, path: tab.path })
  // A renamed file gets a new model in the same editor; that one is named by its own URI.
  const listener = editor.onDidChangeModel(() => {
    const next = editor.getModel()
    if (next) trackDocument(next)
  })
  return () => listener.dispose()
}
