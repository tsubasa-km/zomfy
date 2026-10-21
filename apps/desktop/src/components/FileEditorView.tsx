import { useCallback, useEffect, useRef, useState } from 'react'
import Editor, { type OnMount } from '@monaco-editor/react'
import { HARNESS_METHODS, type FileContent, type FileStat } from '@acp-harness/protocol'
import { harnessRequest } from '@/daemon-connection'
import { getState, setEditorDirty, type EditorTab } from '@/session-store'
import { monaco } from '@/lib/monaco-setup'
import { DropdownMenuCheckboxItem, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuShortcut } from '@/components/ui/dropdown-menu'
import { EditorPanelHeader } from '@/components/editor/EditorPanelHeader'
import { EditorViewToggle } from '@/components/editor/EditorViewToggle'
import { ConflictBanner } from '@/components/editor/ConflictBanner'
import { ExternalFileChangeBanner } from '@/components/editor/ExternalFileChangeBanner'
import { ExternalFileChangeCompareDialog } from '@/components/editor/ExternalFileChangeCompareDialog'
import { MarkdownPreview } from '@/components/editor/MarkdownPreview'
import { BinaryFileView } from '@/components/editor/BinaryFileView'
import { getEditorFileKind } from '@/components/editor/editor-file-kind'
import { updateEditorPreferences, useEditorPreferences, type MarkdownViewMode } from '@/components/editor/editor-preferences'
import { acceptConflict, useMonacoConflicts } from '@/components/editor/use-monaco-conflicts'
import { useFileDiskWatch } from '@/components/editor/use-file-disk-watch'
import { EDITOR_FONT_FAMILY, useDarkClass } from '@/components/editor/use-dark-class'
import { cn } from '@/lib/utils'

type MonacoEditor = Parameters<OnMount>[0]

const MODEL_ROOT = 'file:///__harness'
const MARKDOWN_MODES: readonly MarkdownViewMode[] = ['source', 'split', 'preview']
const isMac = navigator.userAgent.includes('Mac')

function modelUri(tab: EditorTab): string {
  return `${MODEL_ROOT}/${tab.workspaceId}/${tab.path}`
}

/** Models outlive the view so switching tabs keeps unsaved edits; drop the ones whose tab closed. */
function disposeClosedTabModels(): void {
  const open = new Set(getState().editorTabs.map((t) => monaco.Uri.parse(modelUri(t)).toString()))
  for (const model of monaco.editor.getModels()) {
    const uri = model.uri.toString()
    if (uri.startsWith(MODEL_ROOT + '/') && !open.has(uri)) model.dispose()
  }
}

function isTabDirty(id: string): boolean {
  return getState().editorTabs.find((t) => t.id === id)?.dirty === true
}

/** Orca's editor tab: Monaco on the daemon's file, or an image/PDF viewer, chosen by extension. */
export function FileEditorView({ tab }: { tab: EditorTab }) {
  const kind = getEditorFileKind(tab.path)
  if (kind === 'image' || kind === 'pdf') return <BinaryFileView tab={tab} kind={kind} />
  return <TextFileEditor tab={tab} markdown={kind === 'markdown'} />
}

function TextFileEditor({ tab, markdown }: { tab: EditorTab; markdown: boolean }) {
  const [file, setFile] = useState<FileContent | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [codeEditor, setCodeEditor] = useState<MonacoEditor | null>(null)
  const [liveText, setLiveText] = useState('')
  const [externalChange, setExternalChange] = useState<'changed' | 'deleted' | null>(null)
  const [compareOpen, setCompareOpen] = useState(false)
  const [hadConflicts, setHadConflicts] = useState(false)
  const savedText = useRef('')
  const mtime = useRef<number | undefined>(undefined)
  const dark = useDarkClass()
  const prefs = useEditorPreferences()
  const viewMode: MarkdownViewMode = markdown ? prefs.markdownViewMode : 'source'
  const conflicts = useMonacoConflicts(codeEditor)
  const uri = modelUri(tab)

  useEffect(() => {
    if (conflicts.blocks.length > 0) setHadConflicts(true)
  }, [conflicts.blocks.length])

  useEffect(() => () => queueMicrotask(disposeClosedTabModels), [])

  const markDirty = useCallback((text: string) => setEditorDirty(tab.id, text !== savedText.current), [tab.id])

  const load = useCallback(
    async (mode: 'open' | 'reload') => {
      setError(null)
      try {
        const content = await harnessRequest(HARNESS_METHODS.fsRead, { workspaceId: tab.workspaceId, path: tab.path })
        savedText.current = content.content
        mtime.current = content.mtimeMs
        setExternalChange(null)
        setFile(content)
        const model = monaco.editor.getModel(monaco.Uri.parse(uri))
        // A model kept from an earlier visit holds unsaved edits; only a reload replaces them.
        if (model && (mode === 'reload' || !isTabDirty(tab.id)) && model.getValue() !== content.content) {
          // An edit rather than setValue, so the reload can be undone.
          model.pushEditOperations([], [{ range: model.getFullModelRange(), text: content.content }], () => null)
        }
        const text = model?.getValue() ?? content.content
        setLiveText(text)
        markDirty(text)
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      }
    },
    [tab.id, tab.workspaceId, tab.path, uri, markDirty]
  )

  useEffect(() => {
    void load('open')
  }, [load])

  const save = useCallback(async () => {
    if (!codeEditor || !file || file.truncated || file.binary) return
    const text = codeEditor.getValue()
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
      setExternalChange(null)
      markDirty(codeEditor.getValue())
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      if (message.includes('changed on disk')) setExternalChange('changed')
      else setError(message)
    }
  }, [codeEditor, file, tab.workspaceId, tab.path, markDirty])

  // Monaco keeps the first command it was given; route it through the latest save.
  const saveRef = useRef(save)
  saveRef.current = save

  useFileDiskWatch({
    workspaceId: tab.workspaceId,
    path: tab.path,
    knownMtimeMs: mtime,
    enabled: file !== null && !file.truncated,
    onChange: (stat: FileStat) => {
      // Orca reloads clean tabs silently and only asks when unsaved edits are at stake.
      if (!isTabDirty(tab.id) && stat.exists) void load('reload')
      else setExternalChange(stat.exists ? 'changed' : 'deleted')
    }
  })

  const keepMyEdits = (): void => {
    setExternalChange(null)
    // The next save deliberately overwrites the newer disk content.
    void harnessRequest(HARNESS_METHODS.fsStat, { workspaceId: tab.workspaceId, path: tab.path })
      .then((stat) => {
        mtime.current = stat.exists ? stat.mtimeMs : undefined
      })
      .catch(() => undefined)
  }

  const reveal = useCallback(
    (editor: MonacoEditor) => {
      if (!tab.line) return
      editor.revealLineInCenter(tab.line)
      editor.setPosition({ lineNumber: tab.line, column: 1 })
    },
    [tab.line]
  )

  useEffect(() => {
    if (codeEditor) reveal(codeEditor)
  }, [codeEditor, reveal, file])

  const onMount: OnMount = (editor) => {
    // addAction, unlike addCommand, binds the key to this editor only, so other editors cannot steal it.
    editor.addAction({
      id: 'acpHarness.save',
      label: 'Save',
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS],
      run: () => void saveRef.current()
    })
    setCodeEditor(editor)
    const text = editor.getValue()
    setLiveText(text)
    reveal(editor)
    if (viewMode !== 'preview') editor.focus()
  }

  const readOnly = !file || file.binary || file.truncated
  const runEditorAction = (id: string): void => {
    if (!codeEditor) return
    codeEditor.focus()
    void codeEditor.getAction(id)?.run()
  }

  const acceptAll = (choice: 'current' | 'incoming'): void => {
    const model = codeEditor?.getModel()
    if (!model) return
    // Bottom-up so earlier edits do not shift the later blocks' lines.
    for (const block of [...conflicts.blocks].reverse()) acceptConflict(model, block.startLine, choice)
  }

  const markResolved = (): void => {
    void (async () => {
      if (isTabDirty(tab.id)) await saveRef.current()
      await harnessRequest(HARNESS_METHODS.gitStage, { workspaceId: tab.workspaceId, paths: [tab.path] })
      setHadConflicts(false)
    })().catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
  }

  const showSource = viewMode !== 'preview'
  const showPreview = markdown && viewMode !== 'source'

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-editor-surface" data-editor-tab={tab.id}>
      <EditorPanelHeader
        workspaceId={tab.workspaceId}
        path={tab.path}
        status={
          <>
            {file?.truncated && <span className="shrink-0 text-xs text-muted-foreground">First 1 MB, read-only</span>}
            {error && (
              <span className="min-w-0 truncate text-xs text-destructive" title={error}>
                {error}
              </span>
            )}
          </>
        }
        controls={
          markdown && file && !file.binary ? (
            <EditorViewToggle
              value={viewMode}
              modes={MARKDOWN_MODES}
              onChange={(mode) => updateEditorPreferences({ markdownViewMode: mode })}
            />
          ) : undefined
        }
        menuItems={
          <>
            <DropdownMenuItem disabled={!tab.dirty || readOnly} onSelect={() => void save()}>
              Save
              <DropdownMenuShortcut>{isMac ? '⌘S' : 'Ctrl+S'}</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => {
                if (!tab.dirty || window.confirm('Discard unsaved changes and reload from disk?')) void load('reload')
              }}
            >
              Reload from Disk
            </DropdownMenuItem>
            <DropdownMenuItem disabled={!codeEditor || !showSource} onSelect={() => runEditorAction('editor.action.gotoLine')}>
              Go to Line…
              <DropdownMenuShortcut>{isMac ? '⌃G' : 'Ctrl+G'}</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuCheckboxItem
              checked={prefs.editorWordWrap}
              onCheckedChange={() => updateEditorPreferences({ editorWordWrap: !prefs.editorWordWrap })}
            >
              Word Wrap
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem
              checked={prefs.editorMinimap}
              onCheckedChange={() => updateEditorPreferences({ editorMinimap: !prefs.editorMinimap })}
            >
              Minimap
            </DropdownMenuCheckboxItem>
          </>
        }
      />
      {externalChange && (
        <ExternalFileChangeBanner
          deleted={externalChange === 'deleted'}
          onCompare={() => setCompareOpen(true)}
          onReload={() => void load('reload')}
          onKeepEdits={keepMyEdits}
        />
      )}
      {(conflicts.blocks.length > 0 || hadConflicts) && showSource && (
        <ConflictBanner
          total={conflicts.blocks.length}
          currentIndex={conflicts.currentIndex}
          onJump={conflicts.jump}
          onAcceptAll={acceptAll}
          onMarkResolved={markResolved}
        />
      )}
      {file?.binary ? (
        <div className="flex h-full items-center justify-center px-6 text-center">
          <div className="space-y-2">
            <div className="text-sm font-medium text-foreground">Binary file</div>
            <div className="text-xs text-muted-foreground">This file cannot be displayed as text.</div>
          </div>
        </div>
      ) : file ? (
        <div className="flex min-h-0 flex-1">
          <div className={cn('min-h-0 min-w-0 flex-1', !showSource && 'hidden', showPreview && 'border-r border-border')}>
            <Editor
              path={uri}
              defaultValue={file.content}
              keepCurrentModel
              theme={dark ? 'vs-dark' : 'vs'}
              onMount={onMount}
              onChange={(value) => {
                const text = value ?? ''
                markDirty(text)
                if (markdown) setLiveText(text)
              }}
              options={{
                readOnly,
                fontSize: 13,
                fontFamily: EDITOR_FONT_FAMILY,
                minimap: { enabled: prefs.editorMinimap },
                wordWrap: prefs.editorWordWrap ? 'on' : 'off',
                scrollBeyondLastLine: false,
                automaticLayout: true,
                renderWhitespace: 'selection'
              }}
            />
          </div>
          {showPreview && (
            <div className="min-h-0 min-w-0 flex-1">
              <MarkdownPreview content={liveText} workspaceId={tab.workspaceId} filePath={tab.path} />
            </div>
          )}
        </div>
      ) : (
        !error && <p className="p-3 text-xs text-muted-foreground">Loading…</p>
      )}
      {compareOpen && (
        <ExternalFileChangeCompareDialog
          workspaceId={tab.workspaceId}
          path={tab.path}
          currentContent={codeEditor?.getValue() ?? ''}
          onClose={() => setCompareOpen(false)}
          onReload={() => void load('reload')}
          onKeepEdits={keepMyEdits}
        />
      )}
    </div>
  )
}
