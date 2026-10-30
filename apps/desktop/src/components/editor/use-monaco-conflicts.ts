import { useCallback, useEffect, useState } from 'react'
import type { editor } from 'monaco-editor'
import { monaco } from '@/lib/monaco-setup'
import {
  buildConflictResolutionEdit,
  buildGitConflictDecorations,
  findGitConflictBlocks,
  type ConflictBlock,
  type ConflictChoice
} from './monaco-conflict-decorations'
import { t } from '@/i18n/i18n'

const ACCEPT_CONFLICT_COMMAND = 'acpHarness.acceptConflict'
let conflictActionsRegistered = false

export function acceptConflict(model: editor.ITextModel, startLine: number, choice: ConflictChoice): void {
  const block = findGitConflictBlocks(model.getValue()).find((b) => b.startLine === startLine)
  if (!block) return
  model.pushStackElement()
  model.pushEditOperations([], [buildConflictResolutionEdit(model, block, choice)], () => null)
  model.pushStackElement()
}

/** VS Code-style "Accept Current | Accept Incoming | Accept Both" lenses above each conflict. */
function ensureConflictActions(): void {
  if (conflictActionsRegistered) return
  conflictActionsRegistered = true
  monaco.editor.registerCommand(ACCEPT_CONFLICT_COMMAND, (_accessor, uri: string, startLine: number, choice: ConflictChoice) => {
    const model = monaco.editor.getModel(monaco.Uri.parse(uri))
    if (model) acceptConflict(model, startLine, choice)
  })
  monaco.languages.registerCodeLensProvider('*', {
    provideCodeLenses(model) {
      const uri = model.uri.toString()
      const lenses = findGitConflictBlocks(model.getValue()).flatMap((block) => {
        const range = { startLineNumber: block.startLine, startColumn: 1, endLineNumber: block.startLine, endColumn: 1 }
        const lens = (title: string, choice: ConflictChoice) => ({
          range,
          command: { id: ACCEPT_CONFLICT_COMMAND, title, arguments: [uri, block.startLine, choice] }
        })
        return [
          lens(t('Accept Current Change'), 'current'),
          lens(t('Accept Incoming Change'), 'incoming'),
          lens(t('Accept Both Changes'), 'both')
        ]
      })
      return { lenses, dispose: () => undefined }
    }
  })
}

/** Orca's conflict decorations and previous/next navigation for one Monaco editor. */
export function useMonacoConflicts(codeEditor: editor.IStandaloneCodeEditor | null): {
  blocks: ConflictBlock[]
  currentIndex: number | null
  jump: (direction: 'previous' | 'next') => void
} {
  const [blocks, setBlocks] = useState<ConflictBlock[]>([])
  const [cursorLine, setCursorLine] = useState(1)

  useEffect(() => {
    if (!codeEditor) return
    ensureConflictActions()
    const collection = codeEditor.createDecorationsCollection()
    let frame = 0
    const refresh = (): void => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const content = codeEditor.getValue()
        setBlocks(findGitConflictBlocks(content))
        collection.set(buildGitConflictDecorations(content))
      })
    }
    refresh()
    const contentSub = codeEditor.onDidChangeModelContent(refresh)
    const modelSub = codeEditor.onDidChangeModel(refresh)
    const cursorSub = codeEditor.onDidChangeCursorPosition((e) => setCursorLine(e.position.lineNumber))
    return () => {
      cancelAnimationFrame(frame)
      contentSub.dispose()
      modelSub.dispose()
      cursorSub.dispose()
      collection.clear()
    }
  }, [codeEditor])

  const found = blocks.findIndex((b) => cursorLine >= b.startLine && cursorLine <= b.endLine)
  const currentIndex = found >= 0 ? found : null

  const jump = useCallback(
    (direction: 'previous' | 'next') => {
      if (!codeEditor || blocks.length === 0) return
      // Orca's getNextConflictNavigationIndex, falling back to the cursor's position between blocks.
      let next: number
      if (currentIndex !== null) {
        next = direction === 'previous' ? (currentIndex + blocks.length - 1) % blocks.length : (currentIndex + 1) % blocks.length
      } else if (direction === 'next') {
        next = Math.max(0, blocks.findIndex((b) => b.startLine > cursorLine))
      } else {
        const before = blocks.findLastIndex((b) => b.endLine < cursorLine)
        next = before >= 0 ? before : blocks.length - 1
      }
      const target = blocks[next]
      codeEditor.setPosition({ lineNumber: target.startLine, column: 1 })
      codeEditor.revealLineInCenter(target.startLine)
      setCursorLine(target.startLine)
      codeEditor.focus()
    },
    [codeEditor, blocks, currentIndex, cursorLine]
  )

  return { blocks, currentIndex, jump }
}
