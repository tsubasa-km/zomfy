import { useCallback, useEffect, useRef, useState } from 'react'
import Editor, { type OnMount } from '@monaco-editor/react'
import { RefreshCw, Save } from 'lucide-react'
import { HARNESS_METHODS, type FileContent } from '@acp-harness/protocol'
import { harnessRequest } from '@/daemon-connection'
import { setEditorDirty, type EditorTab } from '@/session-store'
import { monaco } from '@/lib/monaco-setup'

type MonacoEditor = Parameters<OnMount>[0]

function useDarkClass(): boolean {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'))
  useEffect(() => {
    const observer = new MutationObserver(() => setDark(document.documentElement.classList.contains('dark')))
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [])
  return dark
}

/** Orca's editor tab: Monaco on the daemon's file, saved with Ctrl/Cmd+S and a conflict check. */
export function FileEditorView({ tab }: { tab: EditorTab }) {
  const [file, setFile] = useState<FileContent | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const editorRef = useRef<MonacoEditor | null>(null)
  const savedText = useRef('')
  const mtime = useRef<number | undefined>(undefined)
  const dark = useDarkClass()

  const load = useCallback(async () => {
    setError(null)
    try {
      const content = await harnessRequest(HARNESS_METHODS.fsRead, { workspaceId: tab.workspaceId, path: tab.path })
      savedText.current = content.content
      mtime.current = content.mtimeMs
      setFile(content)
      editorRef.current?.setValue(content.content)
      setEditorDirty(tab.id, false)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [tab.id, tab.workspaceId, tab.path])

  useEffect(() => {
    void load()
  }, [load])

  const save = useCallback(async () => {
    const editor = editorRef.current
    if (!editor || !file || file.truncated) return
    const text = editor.getValue()
    setSaving(true)
    setError(null)
    try {
      const result = await harnessRequest(HARNESS_METHODS.fsWrite, {
        workspaceId: tab.workspaceId,
        path: tab.path,
        content: text,
        ...(mtime.current !== undefined ? { expectedMtimeMs: mtime.current } : {})
      })
      mtime.current = result.mtimeMs
      savedText.current = text
      setEditorDirty(tab.id, editor.getValue() !== text)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }, [file, tab.id, tab.workspaceId, tab.path])

  // Keep the latest save in the command Monaco holds on to.
  const saveRef = useRef(save)
  saveRef.current = save

  useEffect(() => {
    if (tab.line && editorRef.current) {
      editorRef.current.revealLineInCenter(tab.line)
      editorRef.current.setPosition({ lineNumber: tab.line, column: 1 })
    }
  }, [tab.line, file])

  const onMount: OnMount = (editor) => {
    editorRef.current = editor
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => void saveRef.current())
    if (tab.line) {
      editor.revealLineInCenter(tab.line)
      editor.setPosition({ lineNumber: tab.line, column: 1 })
    }
    editor.focus()
  }

  const readOnly = !file || file.binary || file.truncated

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background" data-editor-tab={tab.id}>
      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-border px-3 text-xs">
        <span className="truncate font-mono text-foreground">{tab.path}</span>
        {tab.dirty && <span className="shrink-0 text-muted-foreground">modified</span>}
        {file?.truncated && <span className="shrink-0 text-muted-foreground">first 1 MB, read-only</span>}
        {error && <span className="min-w-0 truncate text-destructive" title={error}>{error}</span>}
        <div className="ml-auto flex items-center gap-0.5">
          <button
            type="button"
            aria-label="Save"
            disabled={!tab.dirty || saving || readOnly}
            onClick={() => void save()}
            className="flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40"
          >
            <Save className="size-3.5" />
          </button>
          <button
            type="button"
            aria-label="Reload from disk"
            onClick={() => {
              if (!tab.dirty || window.confirm('Discard unsaved changes and reload from disk?')) void load()
            }}
            className="flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <RefreshCw className="size-3.5" />
          </button>
        </div>
      </div>
      {file?.binary ? (
        <p className="p-3 text-xs text-muted-foreground">Binary file.</p>
      ) : file ? (
        <div className="min-h-0 flex-1">
          <Editor
            path={`${tab.workspaceId}/${tab.path}`}
            defaultValue={file.content}
            theme={dark ? 'vs-dark' : 'vs'}
            onMount={onMount}
            onChange={(value) => setEditorDirty(tab.id, (value ?? '') !== savedText.current)}
            options={{
              readOnly,
              fontSize: 13,
              fontFamily: 'Cascadia Code, Consolas, ui-monospace, monospace',
              minimap: { enabled: false },
              scrollBeyondLastLine: false,
              automaticLayout: true,
              renderWhitespace: 'selection'
            }}
          />
        </div>
      ) : (
        !error && <p className="p-3 text-xs text-muted-foreground">Loading…</p>
      )}
    </div>
  )
}
