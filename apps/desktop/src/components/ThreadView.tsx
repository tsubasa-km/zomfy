import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Copy, CornerDownLeft, FileText, GitFork, MessagesSquare, Quote, Search, TextSelect } from 'lucide-react'
import { markSeen, openEditorTab, useStore, type Session, type ThreadItem } from '@/session-store'
import { projectOfSession } from '@/lib/session-project'
import { mainLocationOf } from '@/stores/project-catalog-store'
import { runCommandInline } from '@/lib/terminal-command-run'
import { NativeChatCommandRunContext } from '@/components/native-chat/NativeChatRunCommandButton'
import {
  appendToDraft,
  forkChat,
  forkUnavailableReason,
  isWorking,
  onComposerFocusRequest,
  resumeTurn,
  rewindTo,
  setAutoResume,
  submitPrompt
} from '@/chat-actions'
import { addTodo } from '@/stores/inbox-store'
import { chatAgentLabel } from '@zomfy/protocol'
import { latestTurnEnd } from '@/chat-transcript'
import { askInSideChat } from '@/side-chat-actions'
import { NativeChatUsageLimitBanner } from '@/components/native-chat/NativeChatTurnRecovery'
import { isExternalAgentSession, sessionAgent } from '@/lib/chat-agents'
import { Button } from '@/components/ui/button'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger
} from '@/components/ui/context-menu'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { NativeChatApprovalCard } from '@/components/native-chat/NativeChatApprovalCard'
import { NativeChatComposer } from '@/components/native-chat/NativeChatComposer'
import type { MarkdownEditorHandle } from '@/components/markdown-editor/MarkdownEditor'
import { NativeChatDockedTaskList } from '@/components/native-chat/NativeChatTaskList'
import { NativeChatEmptyState } from '@/components/native-chat/NativeChatEmptyState'
import { ManagerEmptyState } from '@/manager/ManagerEmptyState'
import { NativeChatFindBar } from '@/components/native-chat/NativeChatFindBar'
import { NativeChatJumpToLatest } from '@/components/native-chat/NativeChatJumpToLatest'
import { NativeChatMessageRail, type RailItem } from '@/components/native-chat/NativeChatMessageRail'
import { NativeChatQueuedMessageList } from '@/components/native-chat/NativeChatQueuedMessageList'
import { NativeChatSelectionQuote, formatNativeChatQuote } from '@/components/native-chat/NativeChatSelectionQuote'
import { selectionMarkdown } from '@/components/native-chat/selection-markdown'
import type { TranscriptRowActions } from '@/components/native-chat/NativeChatTranscriptRow'
import { NativeChatTranscriptRows } from '@/components/native-chat/NativeChatTranscriptRows'
import { createTranscriptBuilder } from '@/components/native-chat/native-chat-transcript-model'
import { useNativeChatFind } from '@/components/native-chat/use-native-chat-find'
import { ContinueInTerminalContextMenuItem } from '@/components/native-chat/NativeChatTerminalMenuItem'
import '@/components/native-chat/native-chat-appearance.css'
import { BotChatHeader } from '@/components/bots/BotChatHeader'
import { t } from '@/i18n/i18n'
import { getTabLayoutState } from '@/stores/tab-layout-store'
import { projectLabel } from '@/components/sidebar/workspace-visibility'

// Layout and classes follow Orca's native chat (NativeChatMessageList, NativeChatResolvedView,
// NativeChatComposer, NativeChatWorkingStatus).
const TRANSCRIPT_OUTER_CLASS = 'px-3 pt-10 pb-10 sm:px-4'
const TRANSCRIPT_COLUMN_CLASS = 'mx-auto flex w-full max-w-(--chat-content-max-width) flex-col gap-5 px-[5px]'
/** Within this of the bottom the transcript follows new output (Orca's autoscroll). */
const STICK_DISTANCE_PX = 80
const isMac = navigator.userAgent.includes('Mac')

/**
 * Where each chat was left, kept while its tab stays open: switching back to a tab finds the
 * transcript where it was, while a chat opened afresh starts at its latest message.
 */
const leftAt = new Map<string, { top: number; stick: boolean }>()

type PendingPermission = Extract<ThreadItem, { kind: 'permission' }>

function isPendingPermission(item: ThreadItem): item is PendingPermission {
  return item.kind === 'permission' && item.chosen === null
}

/** The first helper chat working for `parentId` with an unanswered ask, if any. */
function helperAsking(sessions: Session[], parentId: string): Session | undefined {
  return sessions.find((child) => child.parentId === parentId && child.origin === 'workflow' && child.items.some(isPendingPermission))
}

/** `onSendToMain`: a side chat's hand-off of a message or selection to the main chat's composer. */
export function ThreadView({ session, onSendToMain }: { session: Session; onSendToMain?: (text: string) => void }) {
  const rootRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const columnRef = useRef<HTMLDivElement>(null)
  const composerRef = useRef<MarkdownEditorHandle>(null)
  const stick = useRef(leftAt.get(session.id)?.stick ?? true)
  const [atBottom, setAtBottom] = useState(stick.current)
  const [menuTarget, setMenuTarget] = useState<{ selection: string; markdown: string; message: string | null }>({
    selection: '',
    markdown: '',
    message: null
  })
  const [rewindTarget, setRewindTarget] = useState<string | null>(null)
  const working = isWorking(session)
  // ACP has no stable fork or rewind, so other agents' chats go without (as in Orca).
  const claudeOnly = !isExternalAgentSession(session)
  const forkReason = forkUnavailableReason(session)
  const running = working || session.turnStartedAt !== null
  // Grouped again on every streamed chunk, but only from the latest prompt on.
  const [buildTranscript] = useState(createTranscriptBuilder)
  const model = useMemo(() => buildTranscript(session.items, running, session.cwd), [buildTranscript, session.items, running, session.cwd])
  // The latest turn ended short and nothing came after: its row offers Continue or Retry.
  const turnEnd = running ? null : latestTurnEnd(session.items)
  // Runs this chat starts live with the project's main member (workflows are saved there).
  const project = projectOfSession(session)
  const main = project ? mainLocationOf({ hostId: project.hostId, projectId: project.id }) : null
  const workflowHome = {
    hostId: main?.hostId ?? session.hostId,
    projectId: main?.projectId ?? project?.id ?? null,
    projectName: project ? projectLabel(project) : ''
  }
  const agentName = chatAgentLabel(sessionAgent(session))
  const sessionTitle = session.title
  const recoveryRow = turnEnd ? model.rows.findLastIndex((row) => row.kind === 'notice' && row.turnEnd !== undefined) : -1
  // One actions object for every row, kept while nothing in it changes: rows render only when theirs do.
  const rowActions = useMemo(
    (): TranscriptRowActions => ({
      ...(working || !claudeOnly ? {} : { onRewind: setRewindTarget }),
      onForkFrom: (messageId) => void forkChat(session.id, messageId),
      ...(forkReason ? { forkUnavailable: forkReason } : {}),
      cwd: session.cwd,
      workflows: { hostId: workflowHome.hostId, projectId: workflowHome.projectId, projectName: workflowHome.projectName },
      onRevealFile: (path) => openEditorTab({ workspaceId: session.workspaceId, kind: 'file', path, staged: false }),
      nextSteps: {
        agentName,
        onFollowUp: (text) => submitPrompt(session.id, text, []),
        onAddTodo: (text) =>
          void addTodo(text, { hostId: session.hostId, workspaceId: session.workspaceId, sessionId: session.id }, sessionTitle).catch(() => undefined)
      }
    }),
    [working, claudeOnly, forkReason, session.id, session.cwd, session.workspaceId, session.hostId, sessionTitle, agentName, workflowHome.hostId, workflowHome.projectId, workflowHome.projectName]
  )
  const recoveryActions = useMemo(
    (): TranscriptRowActions => ({ ...rowActions, onRecover: (kind) => void resumeTurn(session.id, kind) }),
    [rowActions, session.id]
  )
  const limitResetsAt = turnEnd?.reason === 'usage-limit' ? turnEnd.resetsAt : null
  const showLimitBanner = !running && (turnEnd?.reason === 'usage-limit' || Boolean(session.autoResume))
  const find = useNativeChatFind(columnRef, session.items)
  const shells = useStore((s) => s.hosts[session.hostId]?.shells)
  const commandRunner = useMemo(
    () => ({
      shells: shells ?? [],
      sessionId: session.id,
      run: (request: { shellId: string; input: string; title: string }, blockKey: string) =>
        void runCommandInline(session.workspaceId, { sessionId: session.id, blockKey }, request).catch(() => undefined)
    }),
    [shells, session.workspaceId, session.id]
  )

  useEffect(() => onComposerFocusRequest(session.id, () => composerRef.current?.focus()), [session.id])
  // A side chat's own replies hand off to the main chat instead.
  const askSide = session.sideOf ? undefined : (markdown: string) => void askInSideChat(session, markdown).catch(() => undefined)

  // Showing a session is reading it: it leaves the dashboard's Done lane.
  useEffect(() => markSeen(session.id), [session.id, session.status])
  // Shown again, a chat goes back where it was left; shown for the first time, to its latest message.
  useLayoutEffect(() => {
    const scroller = scrollRef.current
    const kept = leftAt.get(session.id)
    stick.current = kept?.stick ?? true
    setAtBottom(stick.current)
    if (scroller) scroller.scrollTop = stick.current ? scroller.scrollHeight : (kept?.top ?? 0)
    return () => {
      // Its tab closed: opened again later, it starts at the bottom.
      if (!getTabLayoutState().open[session.id]) leftAt.delete(session.id)
    }
  }, [session.id])
  useLayoutEffect(() => {
    const scroller = scrollRef.current
    if (scroller && stick.current) scroller.scrollTop = scroller.scrollHeight
  }, [session.items, session.turnStartedAt])
  // Rows that grow after they render (code, images, a transcript that has just loaded) keep a
  // transcript followed to the bottom there.
  const empty = session.loaded && session.items.length === 0 && !running
  useEffect(() => {
    const scroller = scrollRef.current
    if (!scroller) return
    const follow = () => {
      if (stick.current) scroller.scrollTop = scroller.scrollHeight
    }
    const observer = new ResizeObserver(follow)
    observer.observe(scroller)
    if (columnRef.current) observer.observe(columnRef.current)
    return () => observer.disconnect()
  }, [empty])

  const ownPermission = session.items.findLast(isPendingPermission)
  // A helper working for this thread (split_work's parts, a workflow's steps) asks here, so the
  // person answers in the thread they talk to instead of opening the helper's chat.
  const helper = useStore((s) => (ownPermission ? undefined : helperAsking(s.sessions, session.id)))
  const helperPermission = helper?.items.find(isPendingPermission)
  const pendingPermission = ownPermission ?? helperPermission
  const railItems = useMemo(
    (): RailItem[] =>
      model.rows.flatMap((row, index) =>
        row.kind === 'user' ? [{ id: `${session.id}:${index}`, text: row.item.text.slice(0, 1000).replace(/\s+/g, ' ').slice(0, 200) }] : []
      ),
    [model.rows, session.id]
  )
  const jumpToLatest = () => {
    const scroller = scrollRef.current
    if (!scroller) return
    stick.current = true
    scroller.scrollTo({ top: scroller.scrollHeight, behavior: 'smooth' })
  }
  const quote = (markdown: string) => {
    appendToDraft(session.id, markdown)
    composerRef.current?.focus()
  }

  return (
    <div
      ref={rootRef}
      data-native-chat-root
      data-chat-session-id={session.id}
      data-link-workspace-id={session.workspaceId}
      className="native-chat-appearance flex min-h-0 min-w-0 flex-1 flex-col bg-chat-canvas text-chat-foreground"
      onKeyDown={(event) => {
        if ((isMac ? event.metaKey : event.ctrlKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'f') {
          event.preventDefault()
          find.show()
        }
      }}
    >
      <NativeChatCommandRunContext.Provider value={commandRunner}>
      <div className="relative min-h-0 flex-1">
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <div
              ref={scrollRef}
              tabIndex={-1}
              data-native-chat-scroll
              onScroll={(event) => {
                const el = event.currentTarget
                const near = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_DISTANCE_PX
                stick.current = near
                setAtBottom(near)
                leftAt.set(session.id, { top: el.scrollTop, stick: near })
              }}
              onContextMenu={(event) => {
                const row = event.target instanceof Element ? event.target.closest('[data-native-chat-message-text]') : null
                setMenuTarget({
                  selection: window.getSelection()?.toString() ?? '',
                  markdown: selectionMarkdown(),
                  message: row?.getAttribute('data-native-chat-message-text') ?? null
                })
              }}
              className="scrollbar-sleek relative h-full overflow-y-auto pt-(--tab-top-inset) outline-none [overflow-anchor:none] [scrollbar-gutter:stable_both-edges]"
            >
              <BotChatHeader session={session} />
              {empty ? (
                session.role === 'manager' ? <ManagerEmptyState /> : <NativeChatEmptyState session={session} />
              ) : (
                <div className={TRANSCRIPT_OUTER_CLASS}>
                  <div ref={columnRef} data-native-chat-transcript-column className={TRANSCRIPT_COLUMN_CLASS}>
                    <NativeChatTranscriptRows
                      rows={model.rows}
                      sessionId={session.id}
                      actions={rowActions}
                      recoveryRow={recoveryRow}
                      recoveryActions={recoveryActions}
                    />
                    {session.turnStartedAt !== null && <WorkingStatus startedAt={session.turnStartedAt} />}
                  </div>
                </div>
              )}
            </div>
          </ContextMenuTrigger>
          <ContextMenuContent className="w-56">
            {menuTarget.selection ? (
              <>
                <ContextMenuItem onSelect={() => void navigator.clipboard.writeText(menuTarget.selection)}>
                  <Copy />
                  {t('Copy')}
                </ContextMenuItem>
                {menuTarget.markdown ? (
                  <ContextMenuItem data-native-chat-copy-markdown onSelect={() => void navigator.clipboard.writeText(menuTarget.markdown)}>
                    <FileText />
                    {t('Copy as Markdown')}
                  </ContextMenuItem>
                ) : null}
                <ContextMenuItem onSelect={() => quote(formatNativeChatQuote(menuTarget.selection))}>
                  <Quote />
                  {t('Add selection to thread')}
                </ContextMenuItem>
                {askSide ? (
                  <ContextMenuItem data-native-chat-ask-side onSelect={() => askSide(formatNativeChatQuote(menuTarget.selection))}>
                    <MessagesSquare />
                    {t('Ask in side chat')}
                  </ContextMenuItem>
                ) : null}
              </>
            ) : null}
            {menuTarget.message !== null ? (
              <ContextMenuItem onSelect={() => void navigator.clipboard.writeText(menuTarget.message ?? '')}>
                <TextSelect />
                {t('Copy message')}
              </ContextMenuItem>
            ) : null}
            {onSendToMain && (menuTarget.selection || menuTarget.message) ? (
              <ContextMenuItem
                data-side-chat-send
                onSelect={() => onSendToMain(menuTarget.selection || (menuTarget.message ?? ''))}
              >
                <CornerDownLeft />
                {t('Send to main thread')}
              </ContextMenuItem>
            ) : null}
            {menuTarget.selection || menuTarget.message !== null ? <ContextMenuSeparator /> : null}
            <ContextMenuItem onSelect={() => find.show()}>
              <Search />
              {t('Find in thread')}
              <ContextMenuShortcut>{isMac ? '⌘F' : 'Ctrl+F'}</ContextMenuShortcut>
            </ContextMenuItem>
            <ContextMenuItem data-native-chat-fork disabled={forkReason !== null} onSelect={() => void forkChat(session.id)}>
              <GitFork />
              {t('Fork Thread')}
              {forkReason ? <span className="ml-auto pl-3 text-xs text-muted-foreground">{t('Claude only')}</span> : null}
            </ContextMenuItem>
            <ContinueInTerminalContextMenuItem session={session} />
          </ContextMenuContent>
        </ContextMenu>
        {find.open ? <NativeChatFindBar find={find} /> : null}
        <NativeChatMessageRail items={railItems} scrollRef={scrollRef} />
        <NativeChatJumpToLatest visible={!atBottom && !empty} onJump={jumpToLatest} />
      </div>
      </NativeChatCommandRunContext.Provider>
      <NativeChatSelectionQuote rootRef={rootRef} onQuote={quote} onAskInSideChat={askSide} />
      {pendingPermission && <NativeChatApprovalCard permission={pendingPermission} cwd={helper?.cwd ?? session.cwd} from={helper?.title} />}
      <NativeChatDockedTaskList list={model.taskList} />
      <NativeChatQueuedMessageList sessionId={session.id} working={working} />
      {showLimitBanner ? (
        <NativeChatUsageLimitBanner
          resetsAt={limitResetsAt}
          autoResume={session.autoResume ?? null}
          onResume={() => void resumeTurn(session.id, 'resume')}
          onAutoResumeChange={(enabled) => void setAutoResume(session.id, enabled, limitResetsAt)}
        />
      ) : null}
      <NativeChatComposer session={session} editorRef={composerRef} />
      <Dialog open={rewindTarget !== null} onOpenChange={(open) => !open && setRewindTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('Rewind to this message?')}</DialogTitle>
            <DialogDescription>
              {t(
                'This message and everything after it leave the conversation, and its text returns to the composer. Files the agent changed stay as they are.'
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRewindTarget(null)}>
              {t('Cancel')}
            </Button>
            <Button
              data-native-chat-rewind-confirm
              onClick={() => {
                const target = rewindTarget
                setRewindTarget(null)
                if (target) void rewindTo(session.id, target).then(() => composerRef.current?.focus())
              }}
            >
              {t('Rewind')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function WorkingStatus({ startedAt }: { startedAt: number }) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])
  const seconds = Math.max(0, Math.floor((now - startedAt) / 1000))
  return (
    <div className="flex min-h-8 items-center gap-1 border-b border-border text-sm text-chat-foreground-faint tabular-nums select-none">
      <span>{t('Working for {seconds}s', { seconds })}</span>
    </div>
  )
}
