import type { Project, Workspace } from '@acp-harness/protocol'

// How projects and workspaces are named and ordered wherever they are listed.

export function projectLabel(project: Pick<Project, 'name' | 'displayName'>): string {
  return project.displayName ?? project.name
}

export function workspaceLabel(workspace: Pick<Workspace, 'name' | 'displayName'>): string {
  return workspace.displayName ?? workspace.name
}

export function sortProjects<T extends Project>(projects: T[]): T[] {
  return projects
    .map((project, index) => ({ project, index }))
    .sort((a, b) => (a.project.sortOrder ?? a.index) - (b.project.sortOrder ?? b.index) || a.index - b.index)
    .map((x) => x.project)
}

/** Moves `dragged` before or after `target` in `ids`; returns null when nothing changes. */
export function reorderIds(ids: string[], dragged: string, target: string, position: 'before' | 'after'): string[] | null {
  if (dragged === target) return null
  const rest = ids.filter((id) => id !== dragged)
  const at = rest.indexOf(target)
  if (at === -1) return null
  rest.splice(position === 'before' ? at : at + 1, 0, dragged)
  return rest.join() === ids.join() ? null : rest
}

/**
 * `keys` in the saved order: the saved ones first as saved, then each one not saved yet right after
 * the key before it in `keys`, so a new project shows up where its host lists it.
 */
export function mergeOrder(keys: string[], saved: string[]): string[] {
  const present = new Set(keys)
  const result = saved.filter((k) => present.has(k))
  const placed = new Set(result)
  let last = -1
  for (const key of keys) {
    if (placed.has(key)) {
      last = result.indexOf(key)
      continue
    }
    result.splice(++last, 0, key)
    placed.add(key)
  }
  return result
}
