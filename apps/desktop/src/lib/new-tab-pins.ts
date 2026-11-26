// The "+" menu's pinned items (docs/specs/new-tab-menu-and-pins.md): ids kept in order in the
// `newTabPins` setting, and where a new terminal opens by default. Pure, so tests can run it.

/** Pins a window starts with: the Terminal button the strip always had. */
export const DEFAULT_NEW_TAB_PINS = ['terminal']

/** Pins `id` at the end, or unpins it when already pinned. */
export function togglePin(pins: readonly string[], id: string): string[] {
  return pins.includes(id) ? pins.filter((p) => p !== id) : [...pins, id]
}

export function unpin(pins: readonly string[], id: string): string[] {
  return pins.filter((p) => p !== id)
}

export type PinKind = 'terminal' | 'browser' | 'chat' | 'agent' | 'command' | 'workflow' | 'ssh' | 'panel'

/** What kind of item a pin id names, and the part after its prefix (the agent, command, … id). */
export function parsePin(id: string): { kind: PinKind; key: string } {
  if (id === 'terminal' || id === 'browser') return { kind: id, key: '' }
  const at = id.indexOf(':')
  const prefix = at === -1 ? '' : id.slice(0, at)
  const key = at === -1 ? id : id.slice(at + 1)
  switch (prefix) {
    case 'chat':
    case 'agent':
    case 'command':
    case 'workflow':
    case 'ssh':
      return { kind: prefix, key }
    default:
      // Panels keep their own ids (`panel:explorer`, `plugin:…`).
      return { kind: 'panel', key: id }
  }
}

export interface TerminalPlaceWorkspace {
  id: string
  hostId: string
  projectId: string | null
  isPrimary: boolean
  scratch?: boolean
}

/**
 * The folder a new terminal on `hostId` defaults to: the current workspace when it is on that host,
 * else the host's first project's main checkout, else any of its folders; null when it has none.
 */
export function defaultTerminalWorkspace(
  workspaces: readonly TerminalPlaceWorkspace[],
  hostId: string,
  currentWorkspaceId: string | null
): string | null {
  const onHost = workspaces.filter((w) => w.hostId === hostId)
  const current = onHost.find((w) => w.id === currentWorkspaceId)
  if (current) return current.id
  return (onHost.find((w) => w.isPrimary && w.projectId !== null) ?? onHost.find((w) => !w.scratch) ?? onHost[0])?.id ?? null
}
