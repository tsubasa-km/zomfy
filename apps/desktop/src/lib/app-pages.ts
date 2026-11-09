import { useEffect, useRef } from 'react'
import { setDashboardOpen } from '@/session-store'
import { setBoardOpen } from '@/stores/sidebar-store'
import { setAutomationsPageOpen } from '@/stores/automation-store'
import { setSkillsPageOpen } from '@/stores/app-overlay-store'
import { setTasks } from '@/stores/tasks-store'
import { leaveWorkflows, openWorkflows } from '@/stores/workflows-store'

// The pages the sidebar's rows open (above its project list) show one at a time: opening one
// closes whichever was open, so none is left drawn over or under another.

export type AppPage = 'workflows' | 'dashboard' | 'board' | 'tasks' | 'automations' | 'skills'

const PAGES: readonly AppPage[] = ['workflows', 'dashboard', 'board', 'tasks', 'automations', 'skills']

const CLOSE: Record<AppPage, () => void> = {
  workflows: () => openWorkflows(null),
  dashboard: () => setDashboardOpen(false),
  board: () => setBoardOpen(false),
  tasks: () => setTasks({ open: false }),
  automations: () => setAutomationsPageOpen(false),
  skills: () => setSkillsPageOpen(false)
}

/** Closes the open pages but `keep`; false when the person kept unsaved workflow changes instead. */
export function closePages(open: Record<AppPage, boolean>, keep?: AppPage): boolean {
  if (keep !== 'workflows' && open.workflows && !leaveWorkflows()) return false
  for (const page of PAGES) if (page !== keep && open[page]) CLOSE[page]()
  return true
}

/** Watches which pages are open; one that just opened closes the others (or closes itself if refused). */
export function useOnePageAtATime(open: Record<AppPage, boolean>): void {
  const before = useRef(open)
  useEffect(() => {
    const was = before.current
    before.current = open
    const opened = PAGES.find((page) => open[page] && !was[page])
    if (!opened || !PAGES.some((page) => page !== opened && open[page])) return
    if (!closePages(open, opened)) CLOSE[opened]()
  })
}
