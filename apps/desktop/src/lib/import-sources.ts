import { CHAT_AGENT_IDS, type ChatAgentId } from '@zomfy/protocol'

// The pure parts of the Import dialog (docs/specs/import-dialog.md): which sources a host has, and
// which one the dialog shows.

/** Orca's projects, or the conversations one chat agent's own CLI recorded. */
export type ImportSourceId = 'orca' | ChatAgentId

/** The order sources are listed and picked in: Orca, then the agents in the app's order. */
export const IMPORT_SOURCE_ORDER: readonly ImportSourceId[] = ['orca', ...CHAT_AGENT_IDS]

/** One source's answer on a host; absent (or `skipped`) when it is not asked there. */
export type SourceProbe = { status: 'loading' } | { status: 'ready'; count: number } | { status: 'failed' } | { status: 'skipped' }

export interface FoundSource {
  id: ImportSourceId
  count: number
}

/**
 * The sources found: Orca whenever its profile was read (even with no projects), an agent only with
 * a conversation to import. Failed and skipped sources are left out.
 */
export function foundSources(probes: Partial<Record<ImportSourceId, SourceProbe>>): FoundSource[] {
  return IMPORT_SOURCE_ORDER.flatMap((id): FoundSource[] => {
    const probe = probes[id]
    if (probe?.status !== 'ready') return []
    if (id !== 'orca' && probe.count === 0) return []
    return [{ id, count: probe.count }]
  })
}

/** The sources still being read. */
export function readingSources(probes: Partial<Record<ImportSourceId, SourceProbe>>): ImportSourceId[] {
  return IMPORT_SOURCE_ORDER.filter((id) => probes[id]?.status === 'loading')
}

/**
 * The source the dialog shows: the wanted one (clicked, else asked for) when found; else the first
 * found, once every source before it has answered, so the dialog does not jump as answers arrive.
 * null while that is not known yet, or when nothing was found.
 */
export function shownSource(probes: Partial<Record<ImportSourceId, SourceProbe>>, wanted: ImportSourceId | null): ImportSourceId | null {
  const found = new Set(foundSources(probes).map((s) => s.id))
  if (wanted && found.has(wanted)) return wanted
  // A wanted source still being read is waited for.
  if (wanted && probes[wanted]?.status === 'loading') return null
  for (const id of IMPORT_SOURCE_ORDER) {
    if (probes[id]?.status === 'loading') return null
    if (found.has(id)) return id
  }
  return null
}
