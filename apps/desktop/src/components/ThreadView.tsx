import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Copy, GitFork, Quote, Search, TextSelect } from 'lucide-react'
import { markSeen, openEditorTab, type Session, type ThreadItem } from '@/session-store'
import { appendToDraft, forkChat, isWorking, rewindTo } from '@/chat-actions'
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
import { NativeChatDockedTaskList } from '@/components/native-chat/NativeChatTaskList'
import { NativeChatEmptyState } from '@/components/native-chat/NativeChatEmptyState'
import { NativeChatFindBar } from '@/components/native-chat/NativeChatFindBar'
import { NativeChatJumpToLatest } from '@/components/native-chat/NativeChatJumpToLatest'
import { NativeChatMessageRail, type RailItem } from '@/components/native-chat/NativeChatMessageRail'
import { NativeChatQueuedMessageList } from '@/components/native-chat/NativeChatQueuedMessageList'
import { NativeChatSelectionQuote, formatNativeChatQuote } from '@/components/native-chat/NativeChatSelectionQuote'
import { NativeChatTranscriptRow } from '@/components/native-chat/NativeChatTranscriptRow'
import { buildTranscript } from '@/components/native-chat/native-chat-transcript-model'
import { useNativeChatFind } from '@/components/native-chat/use-native-chat-find'
import '@/components/native-chat/native-chat-appearance.css'

// Layout and classes follow Orca's native chat (NativeChatMessageList, NativeChatResolvedView,
// NativeChatComposer, NativeChatWorkingStatus).
const TRANSCRIPT_OUTER_CLASS = 'px-3 pt-10 pb-10 sm:px-4'
const TRANSCRIPT_COLUMN_CLASS = 'mx-auto flex w-full max-w-(--chat-content-max-width) flex-col gap-5 px-[5px]'
/** Within this of the bottom the transcript follows new output (Orca's autoscroll). */
const STICK_DISTANCE_PX = 80
const isMac = navigator.userAgent.includes('Mac')

export function ThreadView({ session }: { session: Session }) {
  const rootRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const columnRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const stick = useRef(true)
  const [atBottom, setAtBottom] = useState(true)
  const [menuTarget, setMenuTarget] = useState<{ selection: string; message: string | null }>({ selection: '', message: null })
  const [rewindTarget, setRewindTarget] = useState<string | null>(null)
  const working = isWorking(session)
  const running = working || session.turnStartedAt !== null
  const model = useMemo(() => buildTranscript(session.items, running, session.cwd), [session.items, running, session.cwd])
  const find = useNativeChatFind(columnRef, session.items)

  // Showing a session is reading it: it leaves the dashboard's Done lane.
  useEffect(() => markSeen(session.id), [session.id, session.status])
  useLayoutEffect(() => {
    const scroller = scrollRef.current
    if (scroller && stick.current) scroller.scrollTop = scroller.scrollHeight
  }, [session.items, session.turnStartedAt])

  const pendingPermission = session.items.findLast(
    (item): item is Extract<ThreadItem, { kind: 'permission' }> => item.kind === 'permission' && item.chosen === null
  )
  const railItems: RailItem[] = model.rows.flatMap((row, index) =>
    row.kind === 'user' ? [{ id: `${session.id}:${index}`, text: row.item.text.replace(/\s+/g, ' ').slice(0, 200) }] : []
  )
  const empty = session.loaded && session.items.length === 0 && !running

  const jumpToLatest = () => {
    const scroller = scrollRef.current
    if (!scroller) return
    stick.current = true
    scroller.scrollTo({ top: scroller.scrollHeight, behavior: 'smooth' })
  }
  const quote = (markdown: string) => {
    appendToDraft(session.id, markdown)
    textareaRef.current?.focus()
  }

  return (
    <div
      ref={rootRef}
      data-native-chat-root
      className="native-chat-appearance flex min-h-0 min-w-0 flex-1 flex-col bg-chat-canvas text-chat-foreground"
      onKeyDown={(event) => {
        if ((isMac ? event.metaKey : event.ctrlKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'f') {
          event.preventDefault()
          find.show()
        }
      }}
    >
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
              }}
              onContextMenu={(event) => {
                const row = event.target instanceof Element ? event.target.closest('[data-native-chat-message-text]') : null
                setMenuTarget({
                  selection: window.getSelection()?.toString() ?? '',
                  message: row?.getAttribute('data-native-chat-message-text') ?? null
                })
              }}
              className="scrollbar-sleek relative h-full overflow-y-auto outline-none [overflow-anchor:none] [scrollbar-gutter:stable_both-edges]"
            >
              {empty ? (
                <NativeChatEmptyState session={session} />
              ) : (
                <div className={TRANSCRIPT_OUTER_CLASS}>
                  <div ref={columnRef} data-native-chat-transcript-column className={TRANSCRIPT_COLUMN_CLASS}>
                    {model.rows.map((row, index) => (
                      <NativeChatTranscriptRow
                        key={index}
                        row={row}
                        rowKey={`${session.id}:${index}`}
                        actions={{
                          ...(working ? {} : { onRewind: setRewindTarget }),
                          onRevealFile: (path) =>
                            openEditorTab({ workspaceId: session.workspaceId, kind: 'file', path, staged: false })
                        }}
                      />
                    ))}
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
                  Copy
                </ContextMenuItem>
                <ContextMenuItem onSelect={() => quote(formatNativeChatQuote(menuTarget.selection))}>
                  <Quote />
                  Add selection to chat
                </ContextMenuItem>
              </>
            ) : null}
            {menuTarget.message !== null ? (
              <ContextMenuItem onSelect={() => void navigator.clipboard.writeText(menuTarget.message ?? '')}>
                <TextSelect />
                Copy message
              </ContextMenuItem>
            ) : null}
            {menuTarget.selection || menuTarget.message !== null ? <ContextMenuSeparator /> : null}
            <ContextMenuItem onSelect={() => find.show()}>
              <Search />
              Find in chat
              <ContextMenuShortcut>{isMac ? '⌘F' : 'Ctrl+F'}</ContextMenuShortcut>
            </ContextMenuItem>
            <ContextMenuItem data-native-chat-fork onSelect={() => void forkChat(session.id)}>
              <GitFork />
              Fork session
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
        {find.open ? <NativeChatFindBar find={find} /> : null}
        <NativeChatMessageRail items={railItems} scrollRef={scrollRef} />
        <NativeChatJumpToLatest visible={!atBottom && !empty} onJump={jumpToLatest} />
      </div>
      <NativeChatSelectionQuote rootRef={rootRef} onQuote={quote} />
      {pendingPermission && <NativeChatApprovalCard permission={pendingPermission} />}
      <NativeChatDockedTaskList list={model.taskList} />
      <NativeChatQueuedMessageList sessionId={session.id} working={working} />
      <NativeChatComposer session={session} textareaRef={textareaRef} />
      <Dialog open={rewindTarget !== null} onOpenChange={(open) => !open && setRewindTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Rewind to this message?</DialogTitle>
            <DialogDescription>
              This message and everything after it leave the conversation, and its text returns to the composer. Files
              the agent changed stay as they are.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRewindTarget(null)}>
              Cancel
            </Button>
            <Button
              data-native-chat-rewind-confirm
              onClick={() => {
                const target = rewindTarget
                setRewindTarget(null)
                if (target) void rewindTo(session.id, target).then(() => textareaRef.current?.focus())
              }}
            >
              Rewind
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
    <div className="flex min-h-8 items-center gap-1 border-b border-border text-sm text-chat-foreground-faint tabular-nums">
      <span>Working for {seconds}s</span>
    </div>
  )
}
