import { useState } from 'react'
import { open } from '@tauri-apps/plugin-dialog'
import { FolderOpen, Plus, RotateCw } from 'lucide-react'
import { connectLocalDaemon, createSession } from '@/daemon-connection'
import { selectSession, useStore, type Session } from '@/session-store'
import StatusIndicator from '@/components/sidebar/StatusIndicator'
import { ClaudeIcon } from '@/components/agent-icons'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { WorktreeStatus } from '@/lib/worktree-status'
import { cn } from '@/lib/utils'

// Markup and classes follow Orca's sidebar (sidebar/index.tsx, SidebarHeader, worktree-card-*).

function toWorktreeStatus(session: Session): WorktreeStatus {
  switch (session.status) {
    case 'working':
      return 'working'
    case 'needs-you':
      return 'permission'
    case 'error':
      return 'failed'
    default:
      return session.items.length > 0 ? 'done' : 'inactive'
  }
}

function projectName(cwd: string): string {
  return cwd.split(/[\\/]/).filter(Boolean).at(-1) ?? cwd
}

function lastAgentLine(session: Session): string {
  for (let i = session.items.length - 1; i >= 0; i--) {
    const item = session.items[i]
    if (item?.kind === 'agent' && item.text.trim()) return item.text.trim().split('\n')[0] ?? ''
    if (item?.kind === 'permission' && !item.chosen) return `Waiting: ${item.title}`
  }
  return 'No messages yet'
}

export function Sidebar() {
  const connection = useStore((s) => s.connection)
  const sessions = useStore((s) => s.sessions)
  const activeId = useStore((s) => s.activeSessionId)
  const waiting = sessions.filter((s) => s.status === 'needs-you')

  const groups = new Map<string, Session[]>()
  for (const session of sessions) {
    const list = groups.get(session.cwd) ?? []
    list.push(session)
    groups.set(session.cwd, list)
  }

  return (
    <aside className="relative flex w-[280px] min-h-0 flex-shrink-0 flex-col overflow-hidden border-r border-worktree-sidebar-border bg-worktree-sidebar text-worktree-sidebar-foreground">
      <div className="mt-2 flex h-8 min-w-0 items-center justify-between gap-1.5 px-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <ConnectionDot kind={connection.kind} />
          <span className="min-w-0 truncate pl-1 pr-0.5 text-xs font-semibold text-muted-foreground/80 select-none">
            Workspaces
          </span>
        </div>
        {connection.kind === 'connected' && <NewSessionButton />}
      </div>

      {connection.kind === 'offline' && (
        <div className="mx-3 mt-2 space-y-2 rounded-lg border border-border bg-card p-3 text-xs">
          <p className="text-foreground">{connection.reason}</p>
          <p className="text-muted-foreground">
            Run <code className="font-mono">bun run daemon</code>, then retry.
          </p>
          <Button size="sm" variant="outline" onClick={() => void connectLocalDaemon()}>
            <RotateCw className="size-3.5" />
            Retry
          </Button>
        </div>
      )}

      <div className="worktree-sidebar-scrollbar mt-1 min-h-0 flex-1 px-1 pb-3">
        {waiting.length > 0 && (
          <section className="mb-2">
            <SectionHeader label="Waiting for you" count={waiting.length} tone="attention" />
            {waiting.map((s) => (
              <SessionCard key={`w-${s.id}`} session={s} active={s.id === activeId} />
            ))}
          </section>
        )}
        {[...groups.entries()].map(([cwd, list]) => (
          <section key={cwd} className="mb-2">
            <SectionHeader label={projectName(cwd)} title={cwd} count={list.length} />
            {list.map((s) => (
              <SessionCard key={s.id} session={s} active={s.id === activeId} />
            ))}
          </section>
        ))}
        {connection.kind === 'connected' && sessions.length === 0 && (
          <p className="px-3 pt-6 text-center text-xs text-muted-foreground">
            No sessions yet. Use + to open a folder.
          </p>
        )}
      </div>
    </aside>
  )
}

function ConnectionDot({ kind }: { kind: 'connecting' | 'connected' | 'offline' }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            'ml-2 block size-1.5 shrink-0 rounded-full',
            kind === 'connected' && 'bg-emerald-500',
            kind === 'connecting' && 'animate-pulse bg-yellow-500',
            kind === 'offline' && 'bg-red-500'
          )}
        />
      </TooltipTrigger>
      <TooltipContent side="right">Local daemon: {kind}</TooltipContent>
    </Tooltip>
  )
}

function SectionHeader({
  label,
  title,
  count,
  tone
}: {
  label: string
  title?: string
  count: number
  tone?: 'attention'
}) {
  return (
    <div className="flex h-7 min-w-0 items-center gap-1.5 px-2 pt-1" title={title}>
      {tone === 'attention' ? (
        <span className="block size-1.5 shrink-0 rounded-full bg-agent-question" />
      ) : (
        <FolderOpen className="size-3.5 shrink-0 text-muted-foreground" />
      )}
      <div
        className={cn(
          'min-w-0 truncate text-[13px] leading-none font-semibold',
          tone === 'attention' && 'text-agent-question-text'
        )}
      >
        {label}
      </div>
      <span className="text-[11px] text-muted-foreground tabular-nums">{count}</span>
    </div>
  )
}

function SessionCard({ session, active }: { session: Session; active: boolean }) {
  return (
    <div
      className={cn(
        'relative ml-1 flex cursor-pointer flex-col overflow-hidden rounded-lg border border-transparent pt-1.25 pr-1.5 pb-1.5 outline-none transition-[background-color,border-color,opacity,box-shadow] duration-200 select-none',
        !active && 'worktree-sidebar-card-hover'
      )}
      data-worktree-card-surface="true"
      data-worktree-card-active={active ? 'primary' : undefined}
      data-session-status={session.status}
      onClick={() => selectSession(session.id)}
      title={session.cwd}
    >
      <div className="flex min-w-0 items-center justify-between gap-2 pl-2">
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          <StatusIndicator status={toWorktreeStatus(session)} />
          <div className="min-w-0 truncate text-[13px] leading-5">{session.title}</div>
        </div>
        <span className="shrink-0 pr-0.5" aria-label="Claude">
          <ClaudeIcon size={12} />
        </span>
      </div>
      <div className="mt-0.5 min-w-0 truncate pl-[22px] text-[11px] text-muted-foreground">
        {lastAgentLine(session)}
      </div>
    </div>
  )
}

function NewSessionButton() {
  const [busy, setBusy] = useState(false)

  async function pickFolder() {
    const folder = await open({ directory: true, title: 'Choose a folder for the new session' })
    if (typeof folder !== 'string') return
    setBusy(true)
    try {
      await createSession(folder)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          size="icon-xs"
          variant="ghost"
          aria-label="New session"
          disabled={busy}
          onClick={() => void pickFolder()}
        >
          <Plus className="size-3.5" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="right">New session in a folder…</TooltipContent>
    </Tooltip>
  )
}
