import { HARNESS_METHODS } from '@acp-harness/protocol'
import { harnessRequest } from '@/daemon-connection'

// The omnibox's file list: a bounded breadth-first walk of the workspace through fs/list, cached
// briefly so typing does not re-walk the tree.

const MAX_FILES = 3000
const MAX_DIRS = 400
const FRESH_MS = 30_000
const SKIPPED_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'target', 'out', '.next', '.venv'])

const cache = new Map<string, { at: number; files: Promise<string[]> }>()

async function walk(workspaceId: string): Promise<string[]> {
  const files: string[] = []
  const queue = ['']
  let dirs = 0
  while (queue.length > 0 && files.length < MAX_FILES && dirs < MAX_DIRS) {
    const batch = queue.splice(0, 8)
    dirs += batch.length
    const listings = await Promise.all(
      batch.map((dir) => harnessRequest(HARNESS_METHODS.fsList, { workspaceId, dir }).catch(() => []))
    )
    for (const entry of listings.flat()) {
      if (entry.kind === 'dir') {
        if (!SKIPPED_DIRS.has(entry.name)) queue.push(entry.path)
      } else files.push(entry.path)
    }
  }
  return files.slice(0, MAX_FILES)
}

export function workspaceFiles(workspaceId: string): Promise<string[]> {
  const hit = cache.get(workspaceId)
  if (hit && Date.now() - hit.at < FRESH_MS) return hit.files
  const files = walk(workspaceId)
  cache.set(workspaceId, { at: Date.now(), files })
  return files
}

/** Filename matches first, then path matches; shorter paths win ties. */
export function matchFiles(files: string[], query: string, limit: number): string[] {
  const q = query.toLowerCase().replaceAll('\\', '/')
  const scored: { path: string; score: number }[] = []
  for (const path of files) {
    const lower = path.toLowerCase()
    const name = lower.slice(lower.lastIndexOf('/') + 1)
    const score = name.startsWith(q) ? 0 : name.includes(q) ? 1 : lower.includes(q) ? 2 : -1
    if (score >= 0) scored.push({ path, score })
  }
  return scored
    .sort((a, b) => a.score - b.score || a.path.length - b.path.length)
    .slice(0, limit)
    .map((s) => s.path)
}
