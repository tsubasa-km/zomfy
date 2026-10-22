import type { HostedWorkItem, HostingProviderId, WorkItemKind, WorkItemPreset, Workspace } from '@acp-harness/protocol'
import type { HostedProject } from '@/session-store'
import { createExternalStore } from './external-store'

// Orca's Tasks page view state (which project, issues or reviews, which preset), plus the request
// that opens the new-workspace composer from anywhere (Tasks, the composer's own picker).

export interface TasksState {
  open: boolean
  projectId: string | null
  kind: WorkItemKind
  preset: WorkItemPreset
  /** Hosting provider each project's Tasks page last reported, for the sidebar's provider shortcuts. */
  providerByProject: Record<string, HostingProviderId>
}

const KEY = 'acp-harness.tasks.v1'

function readSaved(): Partial<TasksState> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<TasksState>
  } catch {
    return {}
  }
}

const saved = readSaved()
const store = createExternalStore<TasksState>(
  {
    open: false,
    projectId: saved.projectId ?? null,
    kind: saved.kind ?? 'issue',
    preset: saved.preset ?? 'open',
    providerByProject: saved.providerByProject ?? {}
  },
  ({ projectId, kind, preset, providerByProject }) => {
    try {
      localStorage.setItem(KEY, JSON.stringify({ projectId, kind, preset, providerByProject }))
    } catch {
      // Remembered for this session only.
    }
  }
)

export const useTasks = store.use
export const getTasks = store.get

export function setTasks(change: Partial<TasksState>): void {
  store.update((s) => ({ ...s, ...change }))
}

export function rememberProjectProvider(projectId: string, provider: HostingProviderId): void {
  if (store.get().providerByProject[projectId] === provider) return
  store.update((s) => ({ ...s, providerByProject: { ...s.providerByProject, [projectId]: provider } }))
}

export interface NewWorkspaceRequest {
  project: HostedProject
  parent?: Workspace
  /** Orca's linked work item: names the workspace and seeds the agent's first prompt. */
  workItem?: HostedWorkItem
}

const requests = createExternalStore<NewWorkspaceRequest | null>(null)

export const useNewWorkspaceRequest = () => requests.use((r) => r)

export function openNewWorkspace(request: NewWorkspaceRequest | null): void {
  requests.set(request)
}
