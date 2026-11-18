import { useCallback, useEffect, useRef, useState } from 'react'
import Editor, { type OnMount } from '@monaco-editor/react'
import { HARNESS_METHODS, type FileStat, type TextEncoding } from '@acp-harness/protocol'
import { harnessRequest } from '@/daemon-connection'
import { getState, setEditorDirty, type EditorTab } from '@/session-store'
import { monaco } from '@/lib/monaco-setup'
import { DropdownMenuCheckboxItem, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuShortcut } from '@/components/ui/dropdown-menu'
import { EditorPanelHeader } from '@/components/editor/EditorPanelHeader'
import { EditorViewToggle } from '@/components/editor/EditorViewToggle'
import { ConflictBanner } from '@/components/editor/ConflictBanner'
import { ExternalFileChangeBanner } from '@/components/editor/ExternalFileChangeBanner'
import { ExternalFileChangeCompareDialog } from '@/components/editor/ExternalFileChangeCompareDialog'
import { updateEditorPreferences, useEditorPreferences } from '@/components/editor/editor-preferences'
import { PREVIEW_MODES, textPreviewFor, usePreviewMode, type PreviewMode } from '@/components/editor/text-previews'
import { describeDocumentError, readDocument, writeDocument, type OpenedDocument, type TextFormat } from '@/components/editor/file-document'
import { EncodingMenu, formatLabel, LineEndingMenu, type LineEnding } from '@/components/editor/TextFormatMenus'
import { FileChangedNotice, formatBytes, LargeFileViewer } from '@/components/editor/LargeFileViewer'
import { attachLanguageFeatures } from '@/components/editor/editor-language-features'
import { acceptConflict, useMonacoConflicts } from '@/components/editor/use-monaco-conflicts'
import { useFileDiskWatch } from '@/components/editor/use-file-disk-watch'
import { EDITOR_FONT_FAMILY, useDarkClass } from '@/components/editor/use-dark-class'
import { Button } from '@/components/ui/button'
import { REVEAL_LABEL } from '@/components/right-sidebar/explorer-paths'
import { canOpenFileExternally, openFileWithDefaultApp, revealFile } from '@/lib/open-file-externally'
import { cn } from '@/lib/utils'
import { t } from '@/i18n/i18n'

type MonacoEditor = Parameters<OnMount>[0]
type TextModel = NonNullable<ReturnType<MonacoEditor['getModel']>>

const MODEL_ROOT = 'file:///__harness'
const isMac = navigator.userAgent.includes('Mac')
/** A reload of more text than this replaces the model outright: keeping it undoable would hold the old text too. */
const UNDOABLE_RELOAD_CHARS = 5 * 1024 * 1024
/** Files past this get no merge-conflict decorations or lenses. */
const CONFLICT_SCAN_BYTES = 4 * 1024 * 1024
/** A clean tab follows a changed file on its own up to this size; a larger one asks before reading it all again. */
const AUTO_RELOAD_BYTES = 8 * 1024 * 1024

function modelUri(tab: EditorTab): string {
  return `${MODEL_ROOT}/${tab.workspaceId}/${tab.path}`
}

/** What the window knows of the file behind a model: it lives as long as the model, across visits to the tab. */
interface DocumentRecord {
  format: TextFormat
  /** The encoding the person picked to read the file in; reloads keep it instead of detecting. */
  chosenEncoding: TextEncoding | undefined
  malformed: boolean
  mtimeMs: number
  size: number
  /** The model's version that is on disk; any other version is unsaved edits. */
  savedVersionId: number
  truncated: boolean
  legacy: boolean
}

const documents = new Map<string, DocumentRecord>()

/** Models outlive the view so switching tabs keeps unsaved edits; drop the ones whose tab closed. */
function disposeClosedTabModels(): void {
  const open = new Set(getState().editorTabs.map((t) => monaco.Uri.parse(modelUri(t)).toString()))
  for (const model of monaco.editor.getModels()) {
    const uri = model.uri.toString()
    if (uri.startsWith(MODEL_ROOT + '/') && !open.has(uri)) {
      documents.delete(uri)
      model.dispose()
    }
  }
}

function isTabDirty(id: string): boolean {
  return getState().editorTabs.find((t) => t.id === id)?.dirty === true
}

/** The model's text in pieces, as it is now, without building it as one string. */
function* modelPieces(model: TextModel): Generator<string> {
  const snapshot = model.createSnapshot()
  for (let piece = snapshot.read(); piece !== null; piece = snapshot.read()) yield piece
}

function lineEndingOf(model: TextModel): LineEnding {
  return model.getEOL() === '\r\n' ? 'CRLF' : 'LF'
}

type OpenFile =
  | ({ kind: 'text' } & Pick<DocumentRecord, 'format' | 'malformed' | 'truncated' | 'legacy' | 'size'>)
  | { kind: 'binary' }
  | { kind: 'large'; opened: OpenedDocument; chosenEncoding: TextEncoding | undefined }

/**
 * A text file in Monaco, on the daemon's copy of it: loaded and saved through file-document, with the
 * preview its kind of file has beside or instead of the source (text-previews) and whatever language
 * features are registered for it (editor-language-features). A file too large to edit is handed to
 * the read-only viewer once its size is known.
 */
export function TextFileEditor({ tab }: { tab: EditorTab }) {
  const [file, setFile] = useState<OpenFile | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [progress, setProgress] = useState<{ loaded: number; total: number } | null>(null)
  const [saving, setSaving] = useState<number | null>(null)
  const [cancelled, setCancelled] = useState(false)
  const [codeEditor, setCodeEditor] = useState<MonacoEditor | null>(null)
  const [liveText, setLiveText] = useState('')
  const [lineEnding, setLineEnding] = useState<LineEnding>('LF')
  const [externalChange, setExternalChange] = useState<'changed' | 'deleted' | 'newer' | null>(null)
  const [compareOpen, setCompareOpen] = useState(false)
  const [hadConflicts, setHadConflicts] = useState(false)
  const mtime = useRef<number | undefined>(undefined)
  const loading = useRef<AbortController | null>(null)
  const dark = useDarkClass()
  const prefs = useEditorPreferences()
  const preview = textPreviewFor(tab.path)
  const [previewMode, setPreviewMode] = usePreviewMode(preview)
  const viewMode: PreviewMode = preview ? previewMode : 'source'
  // Conflict markers are looked for by reading the whole text on every edit, which a large file cannot afford.
  const heavy = file?.kind === 'text' && file.size > CONFLICT_SCAN_BYTES
  const conflicts = useMonacoConflicts(heavy ? null : codeEditor)
  const uri = modelUri(tab)
  const hasPreview = preview !== null

  useEffect(() => {
    if (conflicts.blocks.length > 0) setHadConflicts(true)
  }, [conflicts.blocks.length])

  useEffect(
    () => () => {
      loading.current?.abort()
      queueMicrotask(disposeClosedTabModels)
    },
    []
  )

  // Completion, diagnostics and the like for this file, detached when the tab goes.
  const languageFeatures = useRef<(() => void) | null>(null)
  useEffect(() => () => languageFeatures.current?.(), [])

  /** Shows `record` as the open file, with the model's current state. */
  const show = useCallback(
    (record: DocumentRecord, model: TextModel) => {
      mtime.current = record.mtimeMs
      setFile({ kind: 'text', format: record.format, malformed: record.malformed, truncated: record.truncated, legacy: record.legacy, size: record.size })
      setLineEnding(lineEndingOf(model))
      if (hasPreview) setLiveText(model.getValue())
      setEditorDirty(tab.id, model.getAlternativeVersionId() !== record.savedVersionId)
    },
    [tab.id, hasPreview]
  )

  /** `encoding`: a value reads the file as that, null detects again, undefined keeps what was picked before. */
  const load = useCallback(
    async (mode: 'open' | 'reload', encoding?: TextEncoding | null) => {
      loading.current?.abort()
      const controller = new AbortController()
      loading.current = controller
      setError(null)
      setCancelled(false)
      const resource = monaco.Uri.parse(uri)
      const key = resource.toString()
      try {
        const known = documents.get(key)
        const kept = monaco.editor.getModel(resource)
        if (mode === 'open' && kept && known) {
          // Back on a tab whose model is still here: only the disk version needs checking.
          show(known, kept)
          const stat = await harnessRequest(HARNESS_METHODS.fsStat, { workspaceId: tab.workspaceId, path: tab.path })
          if (controller.signal.aborted) return
          if (stat.exists && Math.abs(stat.mtimeMs - known.mtimeMs) <= 1) return
          const dirty = kept.getAlternativeVersionId() !== known.savedVersionId
          if (dirty || !stat.exists) {
            setExternalChange(stat.exists ? 'changed' : 'deleted')
            return
          }
          if (stat.size > AUTO_RELOAD_BYTES) {
            setExternalChange('newer')
            return
          }
        }
        const chosen = encoding === undefined ? known?.chosenEncoding : (encoding ?? undefined)
        setProgress({ loaded: 0, total: 0 })
        const opened = await readDocument(tab.workspaceId, tab.path, {
          ...(chosen ? { encoding: chosen } : {}),
          signal: controller.signal,
          onProgress: (loaded, total) => loading.current === controller && setProgress({ loaded, total })
        })
        if (controller.signal.aborted) return
        setExternalChange(null)
        if (opened.kind !== 'text') {
          mtime.current = opened.mtimeMs
          setEditorDirty(tab.id, false)
          setFile(opened.kind === 'binary' ? { kind: 'binary' } : { kind: 'large', opened, chosenEncoding: chosen })
          return
        }
        let model = monaco.editor.getModel(resource)
        // A model kept from an earlier visit holds unsaved edits; only a reload replaces them.
        const keepEdits = model !== null && mode === 'open' && isTabDirty(tab.id)
        if (!model) model = monaco.editor.createModel(opened.content, undefined, resource)
        else if (!keepEdits && model.getValue() !== opened.content) {
          if (opened.content.length > UNDOABLE_RELOAD_CHARS) model.setValue(opened.content)
          // An edit rather than setValue, so the reload can be undone.
          else model.pushEditOperations([], [{ range: model.getFullModelRange(), text: opened.content }], () => null)
        }
        const record: DocumentRecord = {
          format: opened.format,
          chosenEncoding: chosen,
          malformed: opened.malformed,
          mtimeMs: opened.mtimeMs,
          size: opened.size,
          savedVersionId: keepEdits ? -1 : model.getAlternativeVersionId(),
          truncated: opened.truncated,
          legacy: opened.legacy
        }
        documents.set(key, record)
        show(record, model)
      } catch (e) {
        if (loading.current !== controller) return
        if (controller.signal.aborted) setCancelled(true)
        else setError(describeDocumentError(e))
      } finally {
        if (loading.current === controller) setProgress(null)
      }
    },
    [tab.id, tab.workspaceId, tab.path, uri, show]
  )

  useEffect(() => {
    void load('open')
  }, [load])

  // Unsaved edits are the model being at another version than the saved one, so undoing back to it is clean again.
  useEffect(() => {
    const model = codeEditor?.getModel()
    if (!model) return
    const sub = model.onDidChangeContent(() => {
      const record = documents.get(model.uri.toString())
      setEditorDirty(tab.id, !record || model.getAlternativeVersionId() !== record.savedVersionId)
      setLineEnding(lineEndingOf(model))
      if (hasPreview) setLiveText(model.getValue())
    })
    return () => sub.dispose()
  }, [codeEditor, tab.id, hasPreview, file])

  const save = useCallback(
    async (format?: TextFormat): Promise<boolean> => {
      const model = codeEditor?.getModel()
      const record = model ? documents.get(model.uri.toString()) : undefined
      if (!model || !record || record.truncated || file?.kind !== 'text') return false
      if (
        record.malformed &&
        !window.confirm(
          t('Some bytes of this file are not valid {encoding} and were read as �. Saving writes them as that character. Save anyway?', {
            encoding: formatLabel(record.format)
          })
        )
      ) {
        return false
      }
      setSaveError(null)
      const target = format ?? record.format
      const version = model.getAlternativeVersionId()
      const total = model.getValueLength()
      try {
        const result = await writeDocument(tab.workspaceId, tab.path, () => modelPieces(model), target, mtime.current, {
          onProgress: (sent) => setSaving(total > 0 ? sent / total : 0)
        })
        record.format = target
        record.mtimeMs = result.mtimeMs
        if (result.size >= 0) record.size = result.size
        record.savedVersionId = version
        record.malformed = false
        setExternalChange(null)
        show(record, model)
        return true
      } catch (e) {
        const message = describeDocumentError(e)
        if (message.includes('changed on disk')) setExternalChange('changed')
        else setSaveError(message)
        return false
      } finally {
        setSaving(null)
      }
    },
    [codeEditor, file?.kind, tab.workspaceId, tab.path, show]
  )

  // Monaco keeps the first command it was given; route it through the latest save.
  const saveRef = useRef(save)
  saveRef.current = save

  useFileDiskWatch({
    workspaceId: tab.workspaceId,
    path: tab.path,
    knownMtimeMs: mtime,
    enabled: file?.kind === 'text' && !file.truncated,
    onChange: (stat: FileStat) => {
      // Orca reloads clean tabs silently and only asks when unsaved edits are at stake.
      if (isTabDirty(tab.id) || !stat.exists) setExternalChange(stat.exists ? 'changed' : 'deleted')
      else if (stat.size > AUTO_RELOAD_BYTES) setExternalChange('newer')
      else void load('reload')
    }
  })

  const keepMyEdits = (): void => {
    setExternalChange(null)
    // The next save deliberately overwrites the newer disk content.
    void harnessRequest(HARNESS_METHODS.fsStat, { workspaceId: tab.workspaceId, path: tab.path })
      .then((stat) => {
        mtime.current = stat.exists ? stat.mtimeMs : undefined
        const record = documents.get(monaco.Uri.parse(uri).toString())
        if (record && stat.exists) record.mtimeMs = stat.mtimeMs
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
      label: t('Save'),
      keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS],
      run: () => void saveRef.current()
    })
    languageFeatures.current?.()
    languageFeatures.current = attachLanguageFeatures(editor, tab)
    setCodeEditor(editor)
    const model = editor.getModel()
    if (model && hasPreview) setLiveText(model.getValue())
    reveal(editor)
    if (viewMode !== 'preview') editor.focus()
  }

  const reloadFromDisk = (encoding?: TextEncoding | null): void => {
    if (!tab.dirty || window.confirm(t('Discard unsaved changes and reload from disk?'))) void load('reload', encoding)
  }

  if (file?.kind === 'large') {
    return <LargeFileViewer key={file.opened.mtimeMs} tab={tab} opened={file.opened} chosenEncoding={file.chosenEncoding} />
  }

  const text = file?.kind === 'text' ? file : null
  const busy = progress !== null || saving !== null
  const readOnly = !text || text.truncated || busy
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
  const showPreview = preview !== null && viewMode !== 'source'
  const percent = (part: number, whole: number): string => `${whole > 0 ? Math.floor((part / whole) * 100) : 0}%`

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-editor-surface" data-editor-tab={tab.id}>
      <EditorPanelHeader
        workspaceId={tab.workspaceId}
        path={tab.path}
        external
        status={
          <>
            {text?.truncated && <span className="shrink-0 text-xs text-muted-foreground">{t('First 1 MB, read-only')}</span>}
            {text && progress && (
              <span className="shrink-0 text-xs text-muted-foreground" data-editor-transfer="load">
                {t('Loading… {percent}', { percent: percent(progress.loaded, progress.total) })}
              </span>
            )}
            {saving !== null && (
              <span className="shrink-0 text-xs text-muted-foreground" data-editor-transfer="save">
                {t('Saving… {percent}', { percent: percent(saving, 1) })}
              </span>
            )}
            {error && (
              <span className="min-w-0 truncate text-xs text-destructive" title={error}>
                {error}
              </span>
            )}
          </>
        }
        controls={
          text ? (
            <>
              <LineEndingMenu
                value={lineEnding}
                onChange={
                  readOnly
                    ? undefined
                    : (next) => codeEditor?.getModel()?.pushEOL(next === 'CRLF' ? monaco.editor.EndOfLineSequence.CRLF : monaco.editor.EndOfLineSequence.LF)
                }
              />
              <EncodingMenu
                format={text.format}
                malformed={text.malformed}
                onReopen={(encoding) => reloadFromDisk(encoding)}
                onSaveAs={text.legacy || readOnly ? undefined : (format) => void save(format)}
              />
              {preview && <EditorViewToggle value={viewMode} modes={PREVIEW_MODES} onChange={setPreviewMode} />}
            </>
          ) : undefined
        }
        menuItems={
          <>
            <DropdownMenuItem disabled={!tab.dirty || readOnly} onSelect={() => void save()}>
              {t('Save')}
              <DropdownMenuShortcut>{isMac ? '⌘S' : 'Ctrl+S'}</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => reloadFromDisk()}>{t('Reload from Disk')}</DropdownMenuItem>
            <DropdownMenuItem disabled={!codeEditor || !showSource} onSelect={() => runEditorAction('editor.action.gotoLine')}>
              {t('Go to Line…')}
              <DropdownMenuShortcut>{isMac ? '⌃G' : 'Ctrl+G'}</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuCheckboxItem
              checked={prefs.editorWordWrap}
              onCheckedChange={() => updateEditorPreferences({ editorWordWrap: !prefs.editorWordWrap })}
            >
              {t('Word Wrap')}
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem
              checked={prefs.editorMinimap}
              onCheckedChange={() => updateEditorPreferences({ editorMinimap: !prefs.editorMinimap })}
            >
              {t('Minimap')}
            </DropdownMenuCheckboxItem>
          </>
        }
      />
      {saveError && (
        <div role="alert" className="flex shrink-0 items-start justify-between gap-3 border-b border-destructive/20 bg-destructive/5 px-4 py-2 text-xs" data-editor-save-error>
          <span className="min-w-0 text-foreground">{t('Could not save: {reason}', { reason: saveError })}</span>
          <Button type="button" size="xs" variant="ghost" onClick={() => setSaveError(null)}>
            {t('Dismiss')}
          </Button>
        </div>
      )}
      {externalChange === 'newer' ? (
        <FileChangedNotice onReload={() => void load('reload')} />
      ) : (
        externalChange && (
          <ExternalFileChangeBanner
            deleted={externalChange === 'deleted'}
            onCompare={() => setCompareOpen(true)}
            onReload={() => void load('reload')}
            onKeepEdits={keepMyEdits}
          />
        )
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
      {file?.kind === 'binary' ? (
        <div className="flex h-full items-center justify-center px-6 text-center" data-binary-file>
          <div className="space-y-2">
            <div className="text-sm font-medium text-foreground">{t('Binary file')}</div>
            <div className="text-xs text-muted-foreground">{t('This file cannot be displayed as text.')}</div>
            {canOpenFileExternally(tab.workspaceId) && (
              <div className="flex flex-wrap justify-center gap-2 pt-2">
                <Button size="sm" data-binary-action="open-default" onClick={() => openFileWithDefaultApp(tab.workspaceId, tab.path)}>
                  {t('Open with Default App')}
                </Button>
                <Button size="sm" variant="outline" data-binary-action="reveal" onClick={() => revealFile(tab.workspaceId, tab.path)}>
                  {REVEAL_LABEL}
                </Button>
              </div>
            )}
          </div>
        </div>
      ) : text ? (
        <div className="flex min-h-0 flex-1">
          <div className={cn('min-h-0 min-w-0 flex-1', !showSource && 'hidden', showPreview && 'border-r border-border')}>
            <Editor
              path={uri}
              keepCurrentModel
              theme={dark ? 'vs-dark' : 'vs'}
              onMount={onMount}
              options={{
                readOnly,
                fontSize: 13,
                fontFamily: EDITOR_FONT_FAMILY,
                minimap: { enabled: prefs.editorMinimap },
                wordWrap: prefs.editorWordWrap ? 'on' : 'off',
                scrollBeyondLastLine: false,
                automaticLayout: true,
                renderWhitespace: 'selection',
                // The conflict lenses read the whole text too.
                codeLens: !heavy,
                // Past 20 MB or 300k lines Monaco stops tokenizing and syncing the model to its workers.
                largeFileOptimizations: true
              }}
            />
          </div>
          {showPreview && preview && (
            <div className="min-h-0 min-w-0 flex-1" data-text-preview={preview.id}>
              <preview.Component
                content={liveText}
                workspaceId={tab.workspaceId}
                path={tab.path}
                revealLine={(line, column = 1) => {
                  codeEditor?.revealLineInCenter(line)
                  codeEditor?.setPosition({ lineNumber: line, column })
                }}
              />
            </div>
          )}
        </div>
      ) : progress ? (
        <div className="flex h-full items-center justify-center px-6" data-editor-loading>
          <div className="w-64 space-y-2 text-center">
            <div className="text-xs text-muted-foreground">
              {progress.total > 0
                ? t('Loading… {loaded} of {total}', { loaded: formatBytes(progress.loaded), total: formatBytes(progress.total) })
                : t('Loading…')}
            </div>
            <div className="h-1 overflow-hidden rounded bg-muted">
              <div className="h-full bg-primary transition-[width]" style={{ width: percent(progress.loaded, progress.total) }} />
            </div>
            <Button type="button" size="xs" variant="outline" data-editor-loading-cancel onClick={() => loading.current?.abort()}>
              {t('Cancel')}
            </Button>
          </div>
        </div>
      ) : cancelled ? (
        <div className="flex h-full items-center justify-center px-6 text-center" data-editor-load-cancelled>
          <div className="space-y-2">
            <div className="text-xs text-muted-foreground">{t('Loading was cancelled.')}</div>
            <Button type="button" size="xs" variant="outline" onClick={() => void load('reload')}>
              {t('Load File')}
            </Button>
          </div>
        </div>
      ) : (
        !error && <p className="p-3 text-xs text-muted-foreground">{t('Loading…')}</p>
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
