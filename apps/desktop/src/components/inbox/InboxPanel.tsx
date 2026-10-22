import { useEffect, useMemo, useState } from 'react'
import { BotMessageSquare, CheckCheck, Inbox, Link2, Trash2, XIcon } from 'lucide-react'
import { answerPermission } from '@/daemon-connection'
import { allWorkspaces, getState, markSeen, selectSession, selectWorkspace, useStore, type Session } from '@/session-store'
import { addTodo, removeTodo, setInboxOpen, setTodoDone, useInbox } from '@/stores/inbox-store'
import { openManager } from '@/manager/open-manager'
import { AgentQuestionIcon } from '@/components/AgentQuestionIcon'
import { AgentStateDot } from '@/components/AgentStateDot'
import { TuiAgentIcon } from '@/components/terminal/TuiAgentIcon'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { useShortcutLabel } from '@/keybindings/keybinding-registry'
import { sessionAgent } from '@/lib/chat-agents'
import { inboxEntries, questionsOf, type Approval, type InboxEntry } from './inbox-entries'
import type { TodoItem, TodoLink } from '@acp-harness/protocol'

// One place for everything waiting on the person across hosts (the sidebar's "Waiting for you" and
// the dashboard's Needs You / Done lanes, plus the person's own todos). Anchored above the status
// bar like Orca's notification surfaces; Ctrl/Cmd+Alt+I toggles it.

export function InboxPanel() {
  const open = useInbox((s) => s.open)
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setInboxOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])
  if (!open) return null
  return <InboxSurface />
}

function InboxSurface() {
  const sessions = useStore((s) => s.sessions)
  const unread = useStore((s) => s.unread)
  const hosts = useStore((s) => s.hosts)
  const todos = useInbox((s) => s.todos)
  const entries = useMemo(() => inboxEntries(sessions, unread), [sessions, unread])
  const managerShortcut = useShortcutLabel('manager.open')
  const waiting = entries.filter((e) => e.kind !== 'finished')
  const finished = entries.filter((e) => e.kind === 'finished')
  const openTodos = todos.filter((t) => !t.done)
  const where = (session: Session) => {
    const workspace = allWorkspaces({ hosts }).find((w) => w.id === session.workspaceId)
    return `${hosts[session.hostId]?.label ?? session.hostId} · ${workspace ? (workspace.displayName ?? workspace.name) : ''}`
  }
  const offline = (session: Session) => hosts[session.hostId]?.connection.kind !== 'connected'

  return (
    <div
      role="dialog"
      aria-label="Inbox"
      data-inbox
      className="fixed right-3 bottom-8 z-[47] flex max-h-[min(640px,calc(100vh-80px))] w-[400px] max-w-[calc(100vw-24px)] flex-col overflow-hidden rounded-lg border border-border bg-card text-foreground shadow-[0_10px_24px_rgba(0,0,0,0.18)]"
    >
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
        <Inbox className="size-4 text-muted-foreground" />
        <h2 className="text-[13px] font-semibold">Inbox</h2>
        <span className="text-[11px] text-muted-foreground tabular-nums">{waiting.length + finished.length + openTodos.length}</span>
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            data-open-manager
            onClick={() => {
              setInboxOpen(false)
              void openManager()
            }}
            title={`Open the Manager agent${managerShortcut ? ` (${managerShortcut})` : ''}`}
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <BotMessageSquare className="size-3.5" />
            Manager
          </button>
          <button
            type="button"
            aria-label="Close inbox"
            onClick={() => setInboxOpen(false)}
            className="rounded-sm p-1 text-muted-foreground opacity-70 transition-opacity hover:opacity-100"
          >
            <XIcon className="size-4" />
          </button>
        </div>
      </div>
      <div className="scrollbar-sleek min-h-0 flex-1 overflow-y-auto">
        <InboxSection title="Needs you" count={waiting.length}>
          {waiting.map((entry) => (
            <EntryRow key={entryKey(entry)} entry={entry} where={where(entry.session)} offline={offline(entry.session)} />
          ))}
        </InboxSection>
        <InboxSection
          title="Finished"
          count={finished.length}
          action={
            finished.length > 1 ? (
              <button
                type="button"
                className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
                onClick={() => finished.forEach((e) => markSeen(e.session.id))}
              >
                <CheckCheck className="size-3" /> Mark all read
              </button>
            ) : null
          }
        >
          {finished.map((entry) => (
            <EntryRow key={entryKey(entry)} entry={entry} where={where(entry.session)} offline={offline(entry.session)} />
          ))}
        </InboxSection>
        <TodoSection todos={todos} />
      </div>
    </div>
  )
}

function entryKey(entry: InboxEntry): string {
  return entry.kind === 'approval' ? `a:${entry.approval.requestId}` : `${entry.kind}:${entry.session.id}`
}

function InboxSection({
  title,
  count,
  action,
  children
}: {
  title: string
  count: number
  action?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="border-b border-border/60 px-2 py-2 last:border-b-0" data-inbox-section={title}>
      <header className="flex items-center gap-2 px-1 pb-1.5">
        <span className="text-[11px] font-semibold tracking-[0.05em] text-muted-foreground uppercase">{title}</span>
        <span className="rounded-full bg-muted px-1.5 text-[11px] text-muted-foreground tabular-nums">{count}</span>
        <span className="ml-auto">{action}</span>
      </header>
      {count === 0 ? <p className="px-1 pb-1 text-[11px] text-muted-foreground">Nothing here.</p> : <div className="flex flex-col gap-1.5">{children}</div>}
    </section>
  )
}

function EntryRow({ entry, where, offline }: { entry: InboxEntry; where: string; offline: boolean }) {
  const { session } = entry
  const lastReply = entry.kind === 'finished' ? session.items.findLast((i) => i.kind === 'agent') : undefined
  return (
    <div
      data-inbox-entry={entry.kind}
      data-session-id={session.id}
      className={
        entry.kind === 'finished'
          ? 'rounded-md border border-border/60 bg-background px-2 py-1.5'
          : 'rounded-md border border-agent-question/40 bg-agent-question/[0.06] px-2 py-1.5'
      }
    >
      <button
        type="button"
        onClick={() => {
          setInboxOpen(false)
          selectSession(session.id)
        }}
        className="flex w-full items-center gap-1.5 text-left focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        <TuiAgentIcon agent={sessionAgent(session)} size={12} />
        <span className="min-w-0 truncate text-[12px] font-medium">{session.title}</span>
        {offline ? (
          <span className="ml-auto shrink-0 text-[10px] text-muted-foreground" title="Its host is out of contact; it may still be running">
            unverifiable
          </span>
        ) : (
          <AgentStateDot
            state={session.status === 'error' ? 'failed' : entry.kind === 'finished' ? 'done' : 'waiting'}
            className="ml-auto"
          />
        )}
      </button>
      <div className="truncate text-[11px] text-muted-foreground">{where}</div>
      {entry.kind === 'approval' && <ApprovalBody approval={entry.approval} />}
      {entry.kind === 'needs-you' && (
        <p className="mt-1 text-[11px] text-agent-question-text">Waiting on an answer in its chat; open it to reply.</p>
      )}
      {entry.kind === 'finished' && (
        <div className="mt-1 flex items-start gap-2">
          <p className="line-clamp-2 min-w-0 flex-1 text-[11px] leading-snug text-foreground/85">
            {session.status === 'error' ? 'The turn failed.' : (lastReply?.kind === 'agent' && lastReply.text.trim()) || 'Turn finished.'}
          </p>
          <button
            type="button"
            className="shrink-0 text-[11px] text-muted-foreground hover:text-foreground"
            onClick={() => markSeen(session.id)}
          >
            Mark read
          </button>
        </div>
      )}
    </div>
  )
}

function ApprovalBody({ approval }: { approval: Approval }) {
  const questions = questionsOf(approval)
  const options = [...approval.options].sort((a, b) => Number(b.kind.startsWith('allow')) - Number(a.kind.startsWith('allow')))
  return (
    <div className="mt-1">
      <div className="flex items-start gap-1 text-[11px] text-agent-question-text">
        <AgentQuestionIcon className="mt-px size-3 shrink-0" />
        <span className="line-clamp-3 break-words">{questions.length > 0 ? questions.join(' ') : `Allow ${approval.title}?`}</span>
      </div>
      <div className="mt-1.5 flex flex-wrap gap-1">
        {options.map((option, i) => (
          <button
            key={option.optionId}
            type="button"
            data-inbox-option={option.optionId}
            onClick={() => answerPermission(approval.requestId, option.optionId)}
            className={
              i === 0
                ? 'rounded-md bg-primary px-2 py-0.5 text-[11px] font-semibold text-primary-foreground hover:bg-primary/90'
                : 'rounded-md border border-border bg-background px-2 py-0.5 text-[11px] text-foreground hover:bg-accent'
            }
          >
            {option.name}
          </button>
        ))}
      </div>
    </div>
  )
}

/** The active tab (or workspace) as a link target for a new todo. */
function currentLink(): { link: TodoLink; label: string } | null {
  const state = getState()
  const workspaceId = state.activeWorkspaceId
  const workspace = workspaceId ? allWorkspaces().find((w) => w.id === workspaceId) : undefined
  if (!workspace) return null
  const tab = state.activeSessionByWorkspace[workspace.id]
  const session = state.sessions.find((s) => s.id === tab)
  return {
    link: { hostId: workspace.hostId, workspaceId: workspace.id, ...(session ? { sessionId: session.id } : {}) },
    label: session ? session.title : (workspace.displayName ?? workspace.name)
  }
}

function TodoSection({ todos }: { todos: TodoItem[] }) {
  const [text, setText] = useState('')
  const [linkIt, setLinkIt] = useState(false)
  const [showDone, setShowDone] = useState(false)
  const target = useMemo(currentLink, [])
  const open = todos.filter((t) => !t.done)
  const done = todos.filter((t) => t.done)
  const submit = () => {
    const value = text.trim()
    if (!value) return
    setText('')
    void addTodo(value, linkIt && target ? target.link : undefined)
  }
  return (
    <>
      <InboxSection
        title="To do"
        count={open.length}
        action={
          done.length > 0 ? (
            <button type="button" className="text-[11px] text-muted-foreground hover:text-foreground" onClick={() => setShowDone(!showDone)}>
              {showDone ? 'Hide done' : `Show done (${done.length})`}
            </button>
          ) : null
        }
      >
        {[...open, ...(showDone ? done : [])].map((todo) => (
          <TodoRow key={todo.id} todo={todo} />
        ))}
      </InboxSection>
      <form
        className="flex items-center gap-1.5 px-3 pb-3"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <Input
          data-todo-input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Add a todo…"
          className="h-7 text-xs"
        />
        {target && (
          <button
            type="button"
            aria-pressed={linkIt}
            onClick={() => setLinkIt(!linkIt)}
            title={linkIt ? `Linked to ${target.label}` : `Link to ${target.label}`}
            className={
              linkIt
                ? 'shrink-0 rounded-md bg-accent p-1.5 text-foreground'
                : 'shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground'
            }
          >
            <Link2 className="size-3.5" />
          </button>
        )}
      </form>
    </>
  )
}

function TodoRow({ todo }: { todo: TodoItem }) {
  const session = useStore((s) => (todo.link?.sessionId ? s.sessions.find((x) => x.id === todo.link?.sessionId) : undefined))
  const workspace = todo.link?.workspaceId ? allWorkspaces().find((w) => w.id === todo.link?.workspaceId) : undefined
  const linkLabel = session?.title ?? (workspace ? (workspace.displayName ?? workspace.name) : null)
  return (
    <div data-todo={todo.id} className="group flex items-start gap-2 rounded-md px-1 py-1 hover:bg-accent/40">
      <Checkbox className="mt-0.5" checked={todo.done} onCheckedChange={(v) => setTodoDone(todo.id, v === true)} aria-label="Done" />
      <div className="min-w-0 flex-1">
        <p className={todo.done ? 'text-[12px] break-words text-muted-foreground line-through' : 'text-[12px] break-words'}>{todo.text}</p>
        {(todo.fromAgent || linkLabel) && (
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            {todo.fromAgent && <span>from {todo.fromAgent}</span>}
            {linkLabel && (
              <button
                type="button"
                className="inline-flex min-w-0 items-center gap-0.5 hover:text-foreground"
                onClick={() => {
                  setInboxOpen(false)
                  if (session) selectSession(session.id)
                  else if (workspace) selectWorkspace(workspace.id)
                }}
              >
                <Link2 className="size-3 shrink-0" />
                <span className="truncate">{linkLabel}</span>
              </button>
            )}
          </div>
        )}
      </div>
      <button
        type="button"
        aria-label="Delete todo"
        onClick={() => removeTodo(todo.id)}
        className="shrink-0 rounded-sm p-0.5 text-muted-foreground opacity-0 group-hover:opacity-100 hover:text-foreground"
      >
        <Trash2 className="size-3.5" />
      </button>
    </div>
  )
}
