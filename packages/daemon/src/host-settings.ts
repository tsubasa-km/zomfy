import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { DEFAULT_HOST_SETTINGS, type HostSettings } from '@acp-harness/protocol'
import { HARNESS_HOME } from './harness-home.ts'
import { log } from './log.ts'

const SETTINGS_PATH = join(HARNESS_HOME, 'settings.json')

let loaded: Promise<HostSettings> | null = null

/** This host's settings, read once from the harness home; unknown keys from newer clients are kept. */
export function loadHostSettings(): Promise<HostSettings> {
  loaded ??= readFile(SETTINGS_PATH, 'utf8')
    .then((text) => ({ ...DEFAULT_HOST_SETTINGS, ...JSON.parse(text) }) as HostSettings)
    .catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') log(`settings.json unreadable, using defaults: ${error.message}`)
      return { ...DEFAULT_HOST_SETTINGS }
    })
  return loaded
}

export async function updateHostSettings(patch: Partial<HostSettings>): Promise<HostSettings> {
  const next = { ...(await loadHostSettings()), ...patch }
  await mkdir(HARNESS_HOME, { recursive: true })
  await writeFile(SETTINGS_PATH, JSON.stringify(next, null, 2))
  loaded = Promise.resolve(next)
  return next
}
