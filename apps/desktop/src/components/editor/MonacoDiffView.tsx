import { useEffect, useRef } from 'react'
import { DiffEditor, type DiffOnMount } from '@monaco-editor/react'
import { monaco } from '@/lib/monaco-setup'
import { EDITOR_FONT_FAMILY, useDarkClass } from './use-dark-class'

type DiffEditorInstance = Parameters<DiffOnMount>[0]

/** Orca's DiffViewer: Monaco's diff editor, inline or side by side, with an editable working-tree side. */
export function MonacoDiffView({
  modelKey,
  original,
  modified,
  sideBySide,
  editable,
  wordWrap,
  showWhitespace,
  collapseUnchanged,
  onMount,
  onModifiedChange,
  onSave
}: {
  /** Workspace-relative path plus a side tag; the extension picks the language. */
  modelKey: string
  original: string
  modified: string
  sideBySide: boolean
  editable: boolean
  wordWrap: boolean
  showWhitespace: boolean
  collapseUnchanged: boolean
  onMount?: (editor: DiffEditorInstance) => void
  onModifiedChange?: (text: string) => void
  onSave?: (text: string) => void
}): React.JSX.Element {
  const dark = useDarkClass()
  const onSaveRef = useRef(onSave)
  onSaveRef.current = onSave
  const onChangeRef = useRef(onModifiedChange)
  onChangeRef.current = onModifiedChange
  const subscriptions = useRef<monaco.IDisposable[]>([])
  useEffect(() => () => subscriptions.current.forEach((s) => s.dispose()), [])

  const handleMount: DiffOnMount = (diffEditor) => {
    const modifiedEditor = diffEditor.getModifiedEditor()
    // Scoped to this editor; addCommand would rebind Ctrl+S for every editor in the window.
    modifiedEditor.addAction({
      id: 'acpHarness.save',
      label: 'Save',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS],
      run: () => onSaveRef.current?.(modifiedEditor.getValue())
    })
    subscriptions.current.push(modifiedEditor.onDidChangeModelContent(() => onChangeRef.current?.(modifiedEditor.getValue())))
    onMount?.(diffEditor)
  }

  // Monaco keys language off the URI's extension; the query keeps both sides distinct.
  const [path, tag] = modelKey.split('#')
  return (
    <DiffEditor
      height="100%"
      original={original}
      modified={modified}
      theme={dark ? 'vs-dark' : 'vs'}
      onMount={handleMount}
      originalModelPath={`file:///__harness-diff/${path}?side=original&key=${tag ?? ''}`}
      modifiedModelPath={`file:///__harness-diff/${path}?side=modified&key=${tag ?? ''}`}
      options={{
        readOnly: !editable,
        originalEditable: false,
        renderSideBySide: sideBySide,
        useInlineViewWhenSpaceIsLimited: false,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        fontSize: 13,
        fontFamily: EDITOR_FONT_FAMILY,
        lineNumbers: 'on',
        wordWrap: wordWrap ? 'on' : 'off',
        diffWordWrap: wordWrap ? 'on' : 'off',
        // Monaco defaults this to true, which hides indentation-only diffs.
        ignoreTrimWhitespace: !showWhitespace,
        renderWhitespace: showWhitespace ? 'all' : 'selection',
        hideUnchangedRegions: { enabled: collapseUnchanged },
        automaticLayout: true,
        renderOverviewRuler: true,
        padding: { top: 0 }
      }}
    />
  )
}
