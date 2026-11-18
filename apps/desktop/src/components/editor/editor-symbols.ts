import { useEffect, useState } from 'react'
import type { OnMount } from '@monaco-editor/react'
import { StandaloneServices } from 'monaco-editor/esm/vs/editor/standalone/browser/standaloneServices.js'
import { ILanguageFeaturesService } from 'monaco-editor/esm/vs/editor/common/services/languageFeatures.js'
import { monaco } from '@/lib/monaco-setup'

// The symbols the cursor is inside (class › method), for the breadcrumbs. They come from whatever
// answers "document symbols" for the file's language: a language server, or Monaco's own workers.
// Monaco has no public way to ask its registered providers, so this reaches its registry directly.

type MonacoEditor = Parameters<OnMount>[0]
type DocumentSymbol = monaco.languages.DocumentSymbol

async function documentSymbols(model: monaco.editor.ITextModel, token: monaco.CancellationToken): Promise<DocumentSymbol[]> {
  const registry = StandaloneServices.get(ILanguageFeaturesService).documentSymbolProvider
  for (const provider of registry.ordered(model)) {
    try {
      const symbols = await provider.provideDocumentSymbols(model, token)
      if (symbols?.length) return symbols
    } catch {
      // The next provider may still answer.
    }
  }
  return []
}

/** The chain of symbols around `position`, outermost first. */
function trailAt(symbols: readonly DocumentSymbol[], position: monaco.Position): DocumentSymbol[] {
  const trail: DocumentSymbol[] = []
  let level: readonly DocumentSymbol[] = symbols
  for (;;) {
    // The narrowest of the symbols at this level that hold the cursor (a flat list may overlap).
    const inside = level.filter((symbol) => monaco.Range.containsPosition(symbol.range, position))
    if (inside.length === 0) return trail
    const hit = inside.reduce((best, symbol) => (monaco.Range.containsRange(best.range, symbol.range) ? symbol : best))
    trail.push(hit)
    level = hit.children ?? []
  }
}

const sameTrail = (a: DocumentSymbol[], b: DocumentSymbol[]): boolean =>
  a.length === b.length && a.every((symbol, i) => symbol.name === b[i]!.name && symbol.kind === b[i]!.kind)

/** The symbols around the editor's cursor, kept current as the text and the cursor change. */
export function useSymbolTrail(editor: MonacoEditor | null): DocumentSymbol[] {
  const [trail, setTrail] = useState<DocumentSymbol[]>([])
  useEffect(() => {
    if (!editor) return
    let symbols: DocumentSymbol[] = []
    let source: monaco.CancellationTokenSource | null = null
    let timer: number | undefined
    let gone = false

    const place = (): void => {
      const position = editor.getPosition()
      const next = position ? trailAt(symbols, position) : []
      setTrail((current) => (sameTrail(current, next) ? current : next))
    }
    const refresh = (): void => {
      source?.cancel()
      const model = editor.getModel()
      // Past this an outline costs more than a line of breadcrumbs is worth.
      if (!model || model.getValueLength() > 2_000_000) {
        symbols = []
        place()
        return
      }
      const mine = (source = new monaco.CancellationTokenSource())
      void documentSymbols(model, mine.token).then((found) => {
        if (gone || mine.token.isCancellationRequested) return
        symbols = found
        place()
      })
    }
    const later = (ms: number) => (): void => {
      window.clearTimeout(timer)
      timer = window.setTimeout(refresh, ms)
    }

    let registry: { onDidChange: (listener: () => void) => monaco.IDisposable } | null = null
    try {
      registry = StandaloneServices.get(ILanguageFeaturesService).documentSymbolProvider
    } catch {
      registry = null
    }
    const subs = [
      editor.onDidChangeCursorPosition(place),
      editor.onDidChangeModelContent(later(600)),
      editor.onDidChangeModel(later(0)),
      editor.onDidChangeModelLanguage(later(0)),
      // A language server registers its provider some time after the file opens.
      ...(registry ? [registry.onDidChange(later(300))] : [])
    ]
    refresh()
    return () => {
      gone = true
      window.clearTimeout(timer)
      source?.cancel()
      subs.forEach((sub) => sub.dispose())
    }
  }, [editor])
  return trail
}
