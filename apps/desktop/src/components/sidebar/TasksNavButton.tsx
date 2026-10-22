import { List } from 'lucide-react'
import { setDashboardOpen, useStore } from '@/session-store'
import { setBoardOpen, useSidebarStore } from '@/stores/sidebar-store'
import { setTasks, useTasks } from '@/stores/tasks-store'
import { cn } from '@/lib/utils'

// Orca's SidebarNav "Tasks" row (SidebarTaskNavButton): opens the issues / PRs page.

export function TasksNavButton() {
  const open = useTasks((s) => s.open)
  // The dashboard and board draw over Tasks, so Tasks only reads as active when they are closed.
  const dashboardOpen = useStore((s) => s.dashboardOpen)
  const boardOpen = useSidebarStore((s) => s.boardOpen)
  const active = open && !dashboardOpen && !boardOpen
  return (
    <div className="flex flex-col gap-0.5 px-2 pt-2 pb-1">
      <button
        type="button"
        aria-current={active ? 'page' : undefined}
        data-tasks-nav
        className={cn(
          'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] font-medium tracking-tight transition-colors',
          active
            ? 'bg-worktree-sidebar-accent text-worktree-sidebar-accent-foreground'
            : 'text-worktree-sidebar-foreground/60 hover:bg-worktree-sidebar-foreground/8'
        )}
        onClick={() => {
          setDashboardOpen(false)
          setBoardOpen(false)
          setTasks({ open: !active })
        }}
      >
        <List className={cn('size-4 shrink-0', !active && 'text-worktree-sidebar-foreground/30')} strokeWidth={active ? 2.25 : 1.75} />
        <span className="flex-1">Tasks</span>
      </button>
    </div>
  )
}
