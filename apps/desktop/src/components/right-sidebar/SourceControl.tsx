import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Minus, Plus, Trash, Undo2 } from 'lucide-react'
import { HARNESS_METHODS, type GitChange, type GitCommitChanges, type GitDiscardArea, type GitHistoryItem } from '@acp-harness/protocol'
import { harnessRequest } from '@/daemon-connection'
import { openEditorTab } from '@/session-store'
import { useGitStatus } from '@/hooks/use-git-status'
import { ActionButton, ChangeRow, DirectoryRow, SectionHeader } from './source-control/change-rows'
import { CommitArea } from './source-control/CommitArea'
import { GitHistoryPanel } from './source-control/GitHistoryPanel'
import { SourceControlHeader, type SourceControlViewMode } from './source-control/SourceControlHeader'
import { BaseRefDialog, BulkActionBar, DiscardDialog, type PendingDiscard } from './source-control/source-control-dialogs'
import { resolveDropdownItems, resolvePrimaryAction, type ActionInputs } from './source-control/source-control-actions'
import { buildChangeTree, directoryFiles, flattenChangeTree, type ChangeTreeNode } from './source-control/source-control-tree'
import { useBranchContext } from './source-control/use-branch-context'
import { useCommitFlows } from './source-control/use-commit-flows'

// Layout follows Orca's source control panel (source-control/panel/panel-ready.tsx, panel-content.tsx):
// header toolbar, commit area, Changes / Staged / Untracked sections, "Committed on Branch",
// and the commit graph docked at the bottom.

type SectionId = 'conflicts' | 'unstaged' | 'staged' | 'untracked'
type Section = { id: SectionId; items: GitChange[] }

const SECTION_LABEL: Record<SectionId, string> = {
  conflicts: 'Conflicts',
  unstaged: 'Changes',
  staged: 'Staged Changes',
  untracked: 'Untracked Files'
}
const VIEW_MODE_KEY = 'acp-harness:source-control-view-mode'
/** Orca keeps an unsent message per workspace across panel and workspace switches (commit-drafts.ts). */
const commitDrafts = new Map<string, string>()
const isMac = navigator.userAgent.includes('Mac')
const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e))

function readViewMode(): SourceControlViewMode {
  try {
    return localStorage.getItem(VIEW_MODE_KEY) === 'tree' ? 'tree' : 'list'
  } catch {
    return 'list'
  }
}

const toggled = (set: Set<string>, key: string) => {
  const next = new Set(set)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  return next
}

/** A staged rename's old path must travel with it, or unstage/discard leaves the old file deleted in the index. */
const withOldPaths = (entries: GitChange[]) => entries.flatMap((e) => (e.oldPath ? [e.path, e.oldPath] : [e.path]))

export function SourceControl({ workspaceId }: { workspaceId: string }) {
  const { status, refresh } = useGitStatus(workspaceId)
  const [message, setMessageState] = useState(() => commitDrafts.get(workspaceId) ?? '')
  const setMessage = useCallback(
    (next: string) => {
      commitDrafts.set(workspaceId, next)
      setMessageState(next)
    },
    [workspaceId]
  )
  const [viewMode, setViewMode] = useState<SourceControlViewMode>(readViewMode)
  const [filterQuery, setFilterQuery] = useState('')
  const [filterExpanded, setFilterExpanded] = useState(false)
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())
  const [collapsedDirs, setCollapsedDirs] = useState<Set<string>>(() => new Set())
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const anchorKey = useRef<string | null>(null)
  const [pendingDiscard, setPendingDiscard] = useState<PendingDiscard | null>(null)
  const [bulkBusy, setBulkBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [baseRefDialogOpen, setBaseRefDialogOpen] = useState(false)
  const branchContext = useBranchContext(workspaceId, status)

  const mutate = useCallback(
    async (work: () => Promise<unknown>) => {
      setBulkBusy(true)
      setActionError(null)
      try {
        await work()
      } catch (e) {
        setActionError(errorText(e))
      } finally {
        setBulkBusy(false)
        refresh()
      }
    },
    [refresh]
  )
  const stage = useCallback((paths: string[]) => mutate(() => harnessRequest(HARNESS_METHODS.gitStage, { workspaceId, paths })), [mutate, workspaceId])
  const unstage = useCallback((paths: string[]) => mutate(() => harnessRequest(HARNESS_METHODS.gitUnstage, { workspaceId, paths })), [mutate, workspaceId])
  const discard = useCallback(
    (groups: { area: GitDiscardArea; paths: string[] }[]) =>
      mutate(async () => {
        for (const g of groups) if (g.paths.length > 0) await harnessRequest(HARNESS_METHODS.gitDiscard, { workspaceId, paths: g.paths, area: g.area })
      }),
    [mutate, workspaceId]
  )

  // ── Sections ──────────────────────────────────────────────────────────
  const staged = useMemo(() => status?.staged ?? [], [status])
  const unstagedAll = useMemo(() => status?.unstaged ?? [], [status])
  const normalizedFilter = filterQuery.trim().toLowerCase()
  const allSections: Section[] = useMemo(
    () => [
      { id: 'conflicts', items: unstagedAll.filter((c) => c.status === 'conflicted') },
      { id: 'unstaged', items: unstagedAll.filter((c) => c.status !== 'conflicted' && c.status !== 'untracked') },
      { id: 'staged', items: staged },
      { id: 'untracked', items: unstagedAll.filter((c) => c.status === 'untracked') }
    ],
    [staged, unstagedAll]
  )
  const sections = useMemo(
    () =>
      allSections
        .map((s) => ({ ...s, items: normalizedFilter ? s.items.filter((c) => c.path.toLowerCase().includes(normalizedFilter)) : s.items }))
        .filter((s) => s.items.length > 0),
    [allSections, normalizedFilter]
  )
  const rowsBySection = useMemo(() => {
    const out = new Map<SectionId, ChangeTreeNode[]>()
    for (const s of sections) {
      out.set(
        s.id,
        viewMode === 'tree'
          ? flattenChangeTree(buildChangeTree(s.id, s.items), collapsedDirs)
          : s.items.map((entry) => ({ type: 'file', key: `${s.id}::${entry.path}`, entry, depth: 0 }))
      )
    }
    return out
  }, [sections, viewMode, collapsedDirs])

  // Visible file rows in order, for Shift-range selection and bulk actions.
  const visibleFiles = useMemo(() => {
    const out: { key: string; section: SectionId; entry: GitChange }[] = []
    for (const s of sections) {
      if (collapsed.has(s.id)) continue
      for (const row of rowsBySection.get(s.id) ?? []) if (row.type === 'file') out.push({ key: row.key, section: s.id, entry: row.entry })
    }
    return out
  }, [sections, rowsBySection, collapsed])

  // Rows can vanish after staging or a refresh; prune stale selection keys.
  useEffect(() => {
    if (selected.size === 0) return
    const live = new Set(visibleFiles.map((f) => f.key))
    if ([...selected].some((k) => !live.has(k))) setSelected(new Set([...selected].filter((k) => live.has(k))))
  }, [visibleFiles, selected])

  useEffect(() => {
    if (selected.size === 0) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSelected(new Set())
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [selected.size])

  const openDiff = useCallback(
    (section: SectionId, entry: GitChange) => openEditorTab({ workspaceId, kind: 'diff', path: entry.path, staged: section === 'staged' }),
    [workspaceId]
  )

  // Orca's use-selection: plain click opens and clears, Cmd/Ctrl toggles, Shift selects a range.
  const handleRowClick = (event: React.MouseEvent, key: string, section: SectionId, entry: GitChange) => {
    if (event.shiftKey && anchorKey.current) {
      const keys = visibleFiles.map((f) => f.key)
      const from = keys.indexOf(anchorKey.current)
      const to = keys.indexOf(key)
      if (from !== -1 && to !== -1) {
        setSelected(new Set(keys.slice(Math.min(from, to), Math.max(from, to) + 1)))
        return
      }
    }
    if (isMac ? event.metaKey : event.ctrlKey) {
      setSelected((prev) => toggled(prev, key))
      anchorKey.current = key
      return
    }
    if (selected.size > 0) setSelected(new Set())
    anchorKey.current = key
    openDiff(section, entry)
  }

  const selectedFiles = visibleFiles.filter((f) => selected.has(f.key))
  const bulkStage = selectedFiles.filter((f) => f.section !== 'staged').map((f) => f.entry.path)
  const bulkUnstageEntries = selectedFiles.filter((f) => f.section === 'staged').map((f) => f.entry)
  const bulkDiscardGroups = (['unstaged', 'untracked'] as const)
    .map((area) => ({ area, paths: selectedFiles.filter((f) => f.section === area).map((f) => f.entry.path) }))
    .filter((g) => g.paths.length > 0)

  // ── Commit area ───────────────────────────────────────────────────────
  const stageablePaths = allSections.filter((s) => s.id === 'unstaged' || s.id === 'untracked').flatMap((s) => s.items.map((c) => c.path))
  const flows = useCommitFlows({
    workspaceId,
    message,
    setMessage,
    stagedCount: staged.length,
    stageAll: () => stage(stageablePaths),
    onSettled: refresh
  })
  const actionInputs: ActionInputs = {
    stagedCount: staged.length,
    hasStageableChanges: stageablePaths.length > 0,
    hasMessage: message.trim().length > 0,
    hasConflicts: allSections[0]!.items.length > 0,
    isCommitting: flows.isCommitting,
    remoteOp: flows.remoteOp,
    upstream: status ? (status.upstream ?? null) : undefined,
    hasBranch: Boolean(status?.branch),
    hasCommits: Boolean(status?.head)
  }
  const primary = resolvePrimaryAction(actionInputs)
  const dropdown = resolveDropdownItems(actionInputs)
  const showSpinner = primary.kind === 'commit' ? flows.isCommitting : flows.remoteOp !== null && primary.kind === flows.remoteOp
  const generateTooltip = flows.isCommitting
    ? 'Commit in progress…'
    : staged.length === 0
      ? 'Stage at least one file to generate a message.'
      : message.trim()
        ? 'Clear the message to regenerate.'
        : 'Generate commit message with AI'

  // ── Branch compare & history ──────────────────────────────────────────
  const compareSummary = branchContext.compare.result?.summary ?? null
  const branchEntries = (branchContext.compare.result?.entries ?? []).filter((c) => !normalizedFilter || c.path.toLowerCase().includes(normalizedFilter))
  const branchRows: ChangeTreeNode[] =
    viewMode === 'tree'
      ? flattenChangeTree(buildChangeTree('branch', branchEntries), collapsedDirs)
      : branchEntries.map((entry) => ({ type: 'file', key: `branch::${entry.path}`, entry, depth: 0 }))
  const openBranchDiff = (entry: GitChange) => {
    if (!compareSummary?.mergeBase || !compareSummary.headOid) return
    openEditorTab({
      workspaceId,
      kind: 'diff',
      path: entry.path,
      staged: false,
      compare: { base: compareSummary.mergeBase, head: compareSummary.headOid, label: `vs ${compareSummary.baseRef}` }
    })
  }
  const loadCommitFiles = useCallback(
    (item: GitHistoryItem) => harnessRequest(HARNESS_METHODS.gitCommitChanges, { workspaceId, commit: item.id }),
    [workspaceId]
  )
  const openCommitFile = (item: GitHistoryItem, changes: GitCommitChanges, entry: GitChange) =>
    openEditorTab({
      workspaceId,
      kind: 'diff',
      path: entry.path,
      staged: false,
      compare: { base: changes.parent, head: changes.commit, label: `${item.displayId ?? item.id.slice(0, 7)} ${item.subject}` }
    })
  const loadBaseRefs = useCallback(() => harnessRequest(HARNESS_METHODS.gitBaseRefs, { workspaceId }), [workspaceId])

  if (status && !status.isRepo) {
    return <p className="px-3 py-4 text-xs text-muted-foreground">This workspace is not a git repository.</p>
  }

  const notices = [
    flows.commitError && { id: 'commit-area-error', text: flows.commitError },
    flows.remoteError && { id: 'commit-area-remote-error', text: flows.remoteError },
    flows.generateError && { id: 'commit-area-generate-error', text: flows.generateError },
    actionError && { id: 'commit-area-action-error', text: actionError }
  ].filter((n): n is { id: string; text: string } => Boolean(n))

  // Orca hides section-wide actions while filtering so they never act on more than is shown.
  const sectionActions = (section: Section) => {
    if (normalizedFilter) return null
    const area: GitDiscardArea | null = section.id === 'conflicts' ? null : section.id
    return (
      <div className="flex items-center">
        {area && (
          <ActionButton
            icon={area === 'untracked' ? Trash : Undo2}
            title={area === 'untracked' ? 'Delete all untracked' : 'Discard all'}
            disabled={bulkBusy}
            onClick={() => setPendingDiscard({ kind: 'area', area, paths: area === 'staged' ? withOldPaths(section.items) : section.items.map((c) => c.path) })}
          />
        )}
        {section.id === 'staged' ? (
          <ActionButton icon={Minus} title="Unstage all" disabled={bulkBusy} onClick={() => void unstage(withOldPaths(section.items))} />
        ) : (
          <ActionButton
            icon={Plus}
            title={section.id === 'conflicts' ? 'Stage all (mark resolved)' : 'Stage all'}
            disabled={bulkBusy}
            onClick={() => void stage(section.items.map((c) => c.path))}
          />
        )}
      </div>
    )
  }

  const rowActions = (section: SectionId, entries: GitChange[], kind: 'file' | 'folder') => {
    const paths = entries.map((e) => e.path)
    const single = kind === 'file' ? entries[0] : undefined
    return (
      <>
        {(section === 'unstaged' || section === 'untracked') && (
          <ActionButton
            icon={section === 'untracked' ? Trash : Undo2}
            title={
              kind === 'folder'
                ? section === 'untracked'
                  ? 'Delete untracked in folder'
                  : 'Discard folder'
                : section === 'untracked'
                  ? 'Delete untracked file'
                  : single?.status === 'deleted'
                    ? 'Restore file'
                    : 'Discard changes'
            }
            disabled={bulkBusy}
            onClick={() =>
              setPendingDiscard(
                single ? { kind: 'entry', area: section, path: single.path, deleted: single.status === 'deleted', paths } : { kind: 'area', area: section, paths }
              )
            }
          />
        )}
        {section === 'staged' ? (
          <ActionButton icon={Minus} title={kind === 'folder' ? 'Unstage folder' : 'Unstage'} disabled={bulkBusy} onClick={() => void unstage(withOldPaths(entries))} />
        ) : (
          <ActionButton
            icon={Plus}
            title={kind === 'folder' ? 'Stage folder' : section === 'conflicts' ? 'Stage (mark resolved)' : 'Stage'}
            disabled={bulkBusy}
            onClick={() => void stage(paths)}
          />
        )}
      </>
    )
  }

  const renderTreeRows = (rows: ChangeTreeNode[], render: (row: Extract<ChangeTreeNode, { type: 'file' }>) => React.ReactNode, folderActions?: (row: Extract<ChangeTreeNode, { type: 'directory' }>) => React.ReactNode) =>
    rows.map((row) =>
      row.type === 'directory' ? (
        <DirectoryRow
          key={row.key}
          name={row.name}
          depth={row.depth}
          fileCount={row.fileCount}
          collapsed={collapsedDirs.has(row.key)}
          onToggle={() => setCollapsedDirs((prev) => toggled(prev, row.key))}
          actions={folderActions?.(row)}
        />
      ) : (
        render(row)
      )
    )

  const showBranchSection = compareSummary?.status === 'ready' && branchEntries.length > 0

  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden" data-source-control>
      <SourceControlHeader
        filterQuery={filterQuery}
        filterExpanded={filterExpanded}
        onFilterQueryChange={setFilterQuery}
        onFilterExpandedChange={setFilterExpanded}
        viewMode={viewMode}
        onToggleViewMode={() => {
          const next = viewMode === 'list' ? 'tree' : 'list'
          setViewMode(next)
          try {
            localStorage.setItem(VIEW_MODE_KEY, next)
          } catch {
            // Session-only preference when storage is unavailable.
          }
        }}
        onChangeBaseRef={() => setBaseRefDialogOpen(true)}
        onRefresh={() => {
          refresh()
          branchContext.refresh()
        }}
        branch={status?.branch ?? null}
        compareSummary={compareSummary}
        compareLoading={branchContext.compare.loading}
        baseRef={branchContext.baseRef}
      />

      <div className="scrollbar-sleek relative flex flex-1 flex-col overflow-auto pt-1" style={{ paddingBottom: selected.size > 0 ? 50 : undefined }}>
        <CommitArea
          message={message}
          onMessageChange={setMessage}
          onSubmitShortcut={() => {
            if (primary.kind === 'commit' && !primary.disabled) void flows.commit()
          }}
          messageDisabled={flows.isCommitting}
          primary={primary}
          dropdown={dropdown}
          showSpinner={showSpinner}
          showChevronSpinner={(flows.isCommitting || flows.remoteOp !== null || bulkBusy) && !showSpinner}
          onPrimary={() => void flows.runPrimary(primary.kind)}
          onDropdown={(kind) => void flows.runDropdown(kind)}
          generate={{
            running: flows.generating,
            disabled: flows.isCommitting || staged.length === 0 || message.trim().length > 0,
            tooltip: generateTooltip,
            onGenerate: () => void flows.generate(),
            onCancel: flows.cancelGenerate
          }}
          notices={notices}
        />

        {status === null && <p className="px-3 text-xs text-muted-foreground">Loading…</p>}

        {sections.map((section) => (
          <section key={section.id} data-section={section.id}>
            <SectionHeader
              label={SECTION_LABEL[section.id]}
              count={section.items.length}
              collapsed={collapsed.has(section.id)}
              onToggle={() => setCollapsed((prev) => toggled(prev, section.id))}
              actions={sectionActions(section)}
            />
            {!collapsed.has(section.id) &&
              renderTreeRows(
                rowsBySection.get(section.id) ?? [],
                (row) => (
                  <ChangeRow
                    key={row.key}
                    rowKey={row.key}
                    workspaceId={workspaceId}
                    entry={row.entry}
                    depth={row.depth}
                    showPathHint={viewMode === 'list'}
                    selected={selected.has(row.key)}
                    onClick={(e) => handleRowClick(e, row.key, section.id, row.entry)}
                    onOpenDiff={() => openDiff(section.id, row.entry)}
                    onContextMenu={() => {
                      if (selected.size > 0 && !selected.has(row.key)) setSelected(new Set([row.key]))
                    }}
                    actions={rowActions(section.id, [row.entry], 'file')}
                  />
                ),
                // Filtered folders only hold visible descendants, so folder-wide actions would overpromise.
                normalizedFilter ? undefined : (row) => rowActions(section.id, directoryFiles(row), 'folder')
              )}
          </section>
        ))}

        {status && sections.length === 0 && !showBranchSection && (
          <p className="px-3 pt-3 text-xs text-muted-foreground">{normalizedFilter ? 'No files match the filter.' : 'No changes.'}</p>
        )}

        {showBranchSection && compareSummary && (
          <section data-section="branch">
            <SectionHeader
              label="Committed on Branch"
              count={branchEntries.length}
              countTitle={`${branchEntries.length} file${branchEntries.length === 1 ? '' : 's'} changed vs ${compareSummary.baseRef}`}
              collapsed={collapsed.has('branch')}
              onToggle={() => setCollapsed((prev) => toggled(prev, 'branch'))}
            />
            {!collapsed.has('branch') &&
              renderTreeRows(branchRows, (row) => (
                <ChangeRow
                  key={row.key}
                  rowKey={row.key}
                  workspaceId={workspaceId}
                  entry={row.entry}
                  depth={row.depth}
                  showPathHint={viewMode === 'list'}
                  onClick={() => openBranchDiff(row.entry)}
                  onOpenDiff={() => openBranchDiff(row.entry)}
                />
              ))}
          </section>
        )}

        {status?.isRepo && (
          // The graph is reference context, so it stays docked at the bottom as the pane scrolls.
          <div className="sticky bottom-0 z-10 mt-auto shrink-0 border-t border-border bg-sidebar/95 backdrop-blur-sm">
            <GitHistoryPanel
              state={branchContext.history}
              collapsed={collapsed.has('history')}
              onToggle={() => setCollapsed((prev) => toggled(prev, 'history'))}
              onRefresh={branchContext.refresh}
              loadCommitFiles={loadCommitFiles}
              onOpenCommitFile={openCommitFile}
            />
          </div>
        )}
      </div>

      {selected.size > 0 && (
        <BulkActionBar
          selectedCount={selected.size}
          stageableCount={bulkStage.length}
          unstageableCount={bulkUnstageEntries.length}
          discardableCount={bulkDiscardGroups.reduce((n, g) => n + g.paths.length, 0)}
          isExecuting={bulkBusy}
          onStage={() => void stage(bulkStage).then(() => setSelected(new Set()))}
          onUnstage={() => void unstage(withOldPaths(bulkUnstageEntries)).then(() => setSelected(new Set()))}
          onDiscard={() => setPendingDiscard({ kind: 'selection', groups: bulkDiscardGroups })}
          onClear={() => setSelected(new Set())}
        />
      )}

      <DiscardDialog
        pending={pendingDiscard}
        onCancel={() => setPendingDiscard(null)}
        onConfirm={() => {
          const pending = pendingDiscard
          setPendingDiscard(null)
          if (!pending) return
          void discard(pending.kind === 'selection' ? pending.groups : [{ area: pending.area, paths: pending.paths }]).then(() => {
            if (pending.kind === 'selection') setSelected(new Set())
          })
        }}
      />
      <BaseRefDialog
        open={baseRefDialogOpen}
        current={compareSummary?.baseRef ?? branchContext.baseRef}
        loadRefs={loadBaseRefs}
        onOpenChange={setBaseRefDialogOpen}
        onPick={(ref) => {
          setBaseRefDialogOpen(false)
          branchContext.setBaseRef(ref)
        }}
      />
    </div>
  )
}
