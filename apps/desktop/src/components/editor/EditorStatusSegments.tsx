import { useEffect, useState, type ReactNode } from 'react'
import type { OnMount } from '@monaco-editor/react'
import { monaco } from '@/lib/monaco-setup'
import { t } from '@/i18n/i18n'
import { editorStatusButtonClass } from './EditorStatus'

// What a Monaco editor says about itself in the status bar: where the cursor is, how the file is
// indented, and the language it is read as.

type MonacoEditor = Parameters<OnMount>[0]

interface Snapshot {
  line: number
  column: number
  /** Characters selected; 0 with a bare cursor. */
  selected: number
  /** More than one cursor. */
  cursors: number
  spaces: boolean
  tabSize: number
  languageId: string
}

function snapshot(editor: MonacoEditor): Snapshot | null {
  const model = editor.getModel()
  const position = editor.getPosition()
  if (!model || !position) return null
  const selections = editor.getSelections() ?? []
  const options = model.getOptions()
  return {
    line: position.lineNumber,
    column: position.column,
    selected: selections.reduce((sum, range) => sum + model.getValueLengthInRange(range), 0),
    cursors: selections.length,
    spaces: options.insertSpaces,
    tabSize: options.tabSize,
    languageId: model.getLanguageId()
  }
}

function languageName(id: string): string {
  if (id === 'plaintext') return t('Plain Text')
  return monaco.languages.getLanguages().find((language) => language.id === id)?.aliases?.[0] ?? id
}

/** `children` go where VS Code has the encoding and the line endings: after the indentation, before the language. */
export function EditorStatusSegments({ editor, children }: { editor: MonacoEditor; children?: ReactNode }) {
  const [state, setState] = useState(() => snapshot(editor))
  useEffect(() => {
    const read = (): void => setState(snapshot(editor))
    read()
    const subs = [
      editor.onDidChangeCursorSelection(read),
      editor.onDidChangeModel(read),
      editor.onDidChangeModelLanguage(read),
      editor.onDidChangeModelOptions(read)
    ]
    return () => subs.forEach((sub) => sub.dispose())
  }, [editor])
  if (!state) return null

  const run = (action: string): void => {
    editor.focus()
    void editor.getAction(action)?.run()
  }
  const position =
    state.cursors > 1
      ? t('{count} selections', { count: state.cursors })
      : t('Ln {line}, Col {column}', { line: state.line.toLocaleString(), column: state.column.toLocaleString() }) +
        (state.selected > 0 ? ` (${t('{count} selected', { count: state.selected.toLocaleString() })})` : '')

  return (
    <>
      <button type="button" className={editorStatusButtonClass} data-editor-position title={t('Go to Line/Column')} onClick={() => run('editor.action.gotoLine')}>
        {position}
      </button>
      <span className={editorStatusButtonClass} data-editor-indent title={t('Indentation')}>
        {state.spaces ? t('Spaces: {size}', { size: state.tabSize }) : t('Tab Size: {size}', { size: state.tabSize })}
      </span>
      {children}
      <span className={editorStatusButtonClass} data-editor-language={state.languageId} title={t('Language')}>
        {languageName(state.languageId)}
      </span>
    </>
  )
}
