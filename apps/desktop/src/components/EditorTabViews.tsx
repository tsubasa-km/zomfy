import { useCallback, useEffect, useRef, useState } from 'react'
import type { DiffOnMount } from '@monaco-editor/react'
import { ArrowDown, ArrowUp, Columns2, FileText, Rows2 } from 'lucide-react'
import { HARNESS_METHODS } from '@acp-harness/protocol'
import { harnessRequest } from '@/daemon-connection'
import { getState, openEditorTab, setEditorDirty, type EditorTab } from '@/session-store'
import { DropdownMenuCheckboxItem, DropdownMenuItem, DropdownMenuSeparator } from '@/components/ui/dropdown-menu'
import { FileEditorView } from '@/components/FileEditorView'
import { EditorHeaderButton, EditorPanelHeader } from '@/components/editor/EditorPanelHeader'
import { EditorViewToggle } from '@/components/editor/EditorViewToggle'
import { ExternalFileChangeBanner } from '@/components/editor/ExternalFileChangeBanner'
import { ImageDiffViewer } from '@/components/editor/ImageDiffViewer'
import { MarkdownPreview } from '@/components/editor/MarkdownPreview'
import { MonacoDiffView } from '@/components/editor/MonacoDiffView'
import { getEditorFileKind, imageMimeType } from '@/components/editor/editor-file-kind'
import { updateEditorPreferences, useEditorPreferences, type MarkdownViewMode } from '@/components/editor/editor-preferences'
import { hasGitConflictMarkers } from '@/components/editor/monaco-conflict-decorations'
import { useFileDiskWatch } from '@/components/editor/use-file-disk-watch'

type DiffEditorInstance = Parameters<DiffOnMount>[0]

type DiffContent =
  | { kind: 'text'; original: string; modified: string; modifiedExists: boolean; modifiedMtimeMs?: number; editable: boolean }
  | { kind: 'image'; original: string | null; modified: string | null }
  | { kind: 'binary' }
  | { kind: 'conflict' }

const DIFF_MARKDOWN_MODES: readonly MarkdownViewMode[] = ['source', 'preview']

/**
 * Staged diffs compare HEAD with the index; working-tree diffs compare the index with the file
 * on disk, as `git diff` and Orca's diff tabs do.
 */
async function loadDiffContent(tab: EditorTab): Promise<DiffContent> {
  const { workspaceId, path, staged } = tab
  const kind = getEditorFileKind(path)
  if (tab.compare) return loadCommitDiffContent(tab, tab.compare)
  const originalRevision = staged ? 'HEAD' : 'index'
  if (kind === 'image') {
    const [original, modified] = await Promise.all([
      harnessRequest(HARNESS_METHODS.fsReadRevision, { workspaceId, path, revision: originalRevision, encoding: 'base64' }),
      staged
        ? harnessRequest(HARNESS_METHODS.fsReadRevision, { workspaceId, path, revision: 'index', encoding: 'base64' }).then((r) =>
            r.exists ? r.content : null
          )
        : harnessRequest(HARNESS_METHODS.fsReadBinary, { workspaceId, path }).then(
            (r) => r.base64,
            () => null
          )
    ])
    return { kind: 'image', original: original.exists ? original.content : null, modified }
  }
  if (kind === 'pdf') return { kind: 'binary' }
  const original = await harnessRequest(HARNESS_METHODS.fsReadRevision, { workspaceId, path, revision: originalRevision })
  if (original.binary) return { kind: 'binary' }
  if (staged) {
    const index = await harnessRequest(HARNESS_METHODS.fsReadRevision, { workspaceId, path, revision: 'index' })
    if (index.binary) return { kind: 'binary' }
    return { kind: 'text', original: original.content, modified: index.content, modifiedExists: index.exists, editable: false }
  }
  const disk = await harnessRequest(HARNESS_METHODS.fsRead, { workspaceId, path }).catch(() => null)
  if (disk?.binary) return { kind: 'binary' }
  if (disk && hasGitConflictMarkers(disk.content)) return { kind: 'conflict' }
  return {
    kind: 'text',
    original: original.content,
    modified: disk?.content ?? '',
    modifiedExists: disk !== null,
    modifiedMtimeMs: disk?.mtimeMs,
    editable: disk !== null && !disk.truncated
  }
}

/** Two commits (history, compare with base): both sides come from git and are read-only. */
async function loadCommitDiffContent(tab: EditorTab, compare: { base: string; head: string }): Promise<DiffContent> {
  const { workspaceId, path } = tab
  const kind = getEditorFileKind(path)
  if (kind === 'pdf') return { kind: 'binary' }
  const encoding = kind === 'image' ? 'base64' : 'utf8'
  const [original, modified] = await Promise.all(
    [compare.base, compare.head].map((revision) =>
      harnessRequest(HARNESS_METHODS.fsReadRevision, { workspaceId, path, revision, encoding })
    )
  )
  if (!original || !modified) return { kind: 'binary' }
  if (kind === 'image') {
    return { kind: 'image', original: original.exists ? original.content : null, modified: modified.exists ? modified.content : null }
  }
  if (original.binary || modified.binary) return { kind: 'binary' }
  return { kind: 'text', original: original.content, modified: modified.content, modifiedExists: modified.exists, editable: false }
}

/** Orca's single-file diff tab: Monaco's diff editor with an editable working-tree side. */
export function DiffTabView({ tab }: { tab: EditorTab }) {
  const [content, setContent] = useState<DiffContent | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [diffEditor, setDiffEditor] = useState<DiffEditorInstance | null>(null)
  const [changeCount, setChangeCount] = useState(0)
  const [markdownMode, setMarkdownMode] = useState<MarkdownViewMode>('source')
  const [externalChange, setExternalChange] = useState(false)
  const [liveModified, setLiveModified] = useState('')
  const savedText = useRef('')
  const mtime = useRef<number | undefined>(undefined)
  const prefs = useEditorPreferences()
  const isMarkdown = getEditorFileKind(tab.path) === 'markdown'

  const reload = useCallback(() => {
    setError(null)
    void loadDiffContent(tab)
      .then((next) => {
        if (next.kind === 'text') {
          savedText.current = next.modified
          mtime.current = next.modifiedMtimeMs
          setLiveModified(next.modified)
          setEditorDirty(tab.id, false)
        }
        setExternalChange(false)
        setContent(next)
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
  }, [tab])

  useEffect(reload, [reload])

  useEffect(() => {
    if (!diffEditor) return
    const update = (): void => setChangeCount(diffEditor.getLineChanges()?.length ?? 0)
    update()
    const sub = diffEditor.onDidUpdateDiff(update)
    return () => sub.dispose()
  }, [diffEditor])

  useFileDiskWatch({
    workspaceId: tab.workspaceId,
    path: tab.path,
    knownMtimeMs: mtime,
    enabled: !tab.staged && !tab.compare && content?.kind === 'text',
    onChange: () => {
      if (getState().editorTabs.find((t) => t.id === tab.id)?.dirty) setExternalChange(true)
      else reload()
    }
  })

  const save = useCallback(
    async (text: string) => {
      if (content?.kind !== 'text' || !content.editable) return
      try {
        const result = await harnessRequest(HARNESS_METHODS.fsWrite, {
          workspaceId: tab.workspaceId,
          path: tab.path,
          content: text,
          ...(mtime.current !== undefined ? { expectedMtimeMs: mtime.current } : {})
        })
        mtime.current = result.mtimeMs
        savedText.current = text
        setExternalChange(false)
        setEditorDirty(tab.id, false)
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e)
        if (message.includes('changed on disk')) setExternalChange(true)
        else setError(message)
      }
    },
    [content, tab.id, tab.workspaceId, tab.path]
  )

  if (content?.kind === 'conflict') return <FileEditorView tab={tab} />

  const sideBySide = prefs.diffSideBySide
  const isText = content?.kind === 'text'
  const showMarkdownPreview = isMarkdown && isText && markdownMode === 'preview'
  const canOpenFile = !tab.staged ? content?.kind !== 'text' || content.modifiedExists : true

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-editor-surface" data-editor-tab={tab.id} data-diff-tab>
      <EditorPanelHeader
        workspaceId={tab.workspaceId}
        path={tab.path}
        status={
          <>
            <span className="shrink-0 text-xs text-muted-foreground">{tab.compare?.label ?? (tab.staged ? 'Staged' : 'Working tree')}</span>
            {error && (
              <span className="min-w-0 truncate text-xs text-destructive" title={error}>
                {error}
              </span>
            )}
          </>
        }
        controls={
          <>
            <EditorHeaderButton
              label="Open file"
              disabled={!canOpenFile}
              onClick={() => openEditorTab({ workspaceId: tab.workspaceId, kind: 'file', path: tab.path, staged: false })}
            >
              <FileText size={14} />
            </EditorHeaderButton>
            {!showMarkdownPreview && content?.kind !== 'binary' && (
              <EditorHeaderButton
                label={sideBySide ? 'Switch to inline diff' : 'Switch to side-by-side diff'}
                onClick={() => updateEditorPreferences({ diffSideBySide: !sideBySide })}
              >
                {sideBySide ? <Rows2 size={14} /> : <Columns2 size={14} />}
              </EditorHeaderButton>
            )}
            {isText && !showMarkdownPreview && (
              <>
                <EditorHeaderButton label="Previous change" disabled={changeCount === 0} onClick={() => diffEditor?.goToDiff('previous')}>
                  <ArrowUp size={14} />
                </EditorHeaderButton>
                <EditorHeaderButton label="Next change" disabled={changeCount === 0} onClick={() => diffEditor?.goToDiff('next')}>
                  <ArrowDown size={14} />
                </EditorHeaderButton>
              </>
            )}
            {isMarkdown && isText && <EditorViewToggle value={markdownMode} modes={DIFF_MARKDOWN_MODES} onChange={setMarkdownMode} />}
          </>
        }
        menuItems={
          <>
            <DropdownMenuItem onSelect={reload}>Reload</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuCheckboxItem
              checked={prefs.diffWordWrap}
              onCheckedChange={() => updateEditorPreferences({ diffWordWrap: !prefs.diffWordWrap })}
            >
              Word Wrap
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem
              checked={prefs.diffShowWhitespace}
              onCheckedChange={() => updateEditorPreferences({ diffShowWhitespace: !prefs.diffShowWhitespace })}
            >
              Show Whitespace
            </DropdownMenuCheckboxItem>
            <DropdownMenuCheckboxItem
              checked={prefs.diffCollapseUnchangedRegions}
              onCheckedChange={() =>
                updateEditorPreferences({ diffCollapseUnchangedRegions: !prefs.diffCollapseUnchangedRegions })
              }
            >
              Collapse Unchanged Regions
            </DropdownMenuCheckboxItem>
          </>
        }
      />
      {externalChange && (
        <ExternalFileChangeBanner
          deleted={false}
          onReload={reload}
          onKeepEdits={() => {
            setExternalChange(false)
            void harnessRequest(HARNESS_METHODS.fsStat, { workspaceId: tab.workspaceId, path: tab.path }).then((stat) => {
              mtime.current = stat.exists ? stat.mtimeMs : undefined
            })
          }}
        />
      )}
      <div className="flex min-h-0 flex-1 flex-col">
        {!content && !error && <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Loading diff...</div>}
        {content?.kind === 'binary' && (
          <div className="flex h-full items-center justify-center px-6 text-center">
            <div className="space-y-2">
              <div className="text-sm font-medium text-foreground">Binary file changed</div>
              <div className="text-xs text-muted-foreground">Text diff is unavailable for this file.</div>
            </div>
          </div>
        )}
        {content?.kind === 'image' && (
          <ImageDiffViewer
            original={content.original}
            modified={content.modified}
            filePath={tab.path}
            mimeType={imageMimeType(tab.path) ?? 'image/png'}
            sideBySide={sideBySide}
          />
        )}
        {content?.kind === 'text' && showMarkdownPreview && (
          <>
            <div className="shrink-0 border-b border-border/60 bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
              Previewing the modified version of this diff. Switch to source mode to inspect changes.
            </div>
            <div className="min-h-0 flex-1">
              <MarkdownPreview content={liveModified} workspaceId={tab.workspaceId} filePath={tab.path} />
            </div>
          </>
        )}
        {content?.kind === 'text' && !showMarkdownPreview && (
          <div className="min-h-0 flex-1">
            <MonacoDiffView
              modelKey={`${tab.workspaceId}/${tab.path}#${tab.id}`}
              original={content.original}
              modified={content.modified}
              sideBySide={sideBySide}
              editable={content.editable}
              wordWrap={prefs.diffWordWrap}
              showWhitespace={prefs.diffShowWhitespace}
              collapseUnchanged={prefs.diffCollapseUnchangedRegions}
              onMount={setDiffEditor}
              onModifiedChange={(text) => {
                setLiveModified(text)
                setEditorDirty(tab.id, text !== savedText.current)
              }}
              onSave={(text) => void save(text)}
            />
          </div>
        )}
      </div>
    </div>
  )
}
