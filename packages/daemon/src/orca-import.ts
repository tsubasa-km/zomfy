import { Database } from 'bun:sqlite'
import { copyFile, mkdtemp, readFile, rm } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import type { OrcaProject } from '@acp-harness/protocol'

/** Orca's Electron userData folder for the packaged app (not the `orca-dev` build). */
function orcaUserData(): string {
  if (process.platform === 'win32') return join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'orca')
  if (process.platform === 'darwin') return join(homedir(), 'Library', 'Application Support', 'orca')
  return join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'orca')
}

interface OrcaRepo {
  path?: string
  displayName?: string
  kind?: string
  connectionId?: string | null
}

/**
 * Reads the projects of Orca's active profile. The database is copied first so a running Orca's
 * lock is never touched; nothing is written back.
 */
export async function readOrcaProjects(): Promise<OrcaProject[]> {
  const userData = orcaUserData()
  const index = JSON.parse(await readFile(join(userData, 'orca-profile-index.json'), 'utf8'))
  const profileId: string = index.activeProfileId
  const source = join(userData, 'profiles', profileId, 'profile-state.db')

  const scratch = await mkdtemp(join(tmpdir(), 'acp-harness-orca-'))
  try {
    const copy = join(scratch, 'profile-state.db')
    await copyFile(source, copy)
    const db = new Database(copy, { readonly: true })
    try {
      const row = db.query("select payload from profile_state_documents where domain = 'repos'").get() as
        | { payload: string }
        | null
      const repos: OrcaRepo[] = row ? JSON.parse(row.payload) : []
      return repos
        // SSH-backed repos need an SSH host, which the harness cannot reach yet.
        .filter((r) => r.path && !r.connectionId)
        .map((r) => ({
          name: r.displayName ?? r.path!.split(/[\\/]/).filter(Boolean).at(-1) ?? r.path!,
          path: r.path!,
          kind: r.kind === 'folder' ? 'folder' : 'git'
        }))
    } finally {
      db.close()
    }
  } finally {
    await rm(scratch, { recursive: true, force: true })
  }
}
