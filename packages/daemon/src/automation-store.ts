import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Automation, AutomationRun } from '@acp-harness/protocol'
import { HARNESS_HOME } from './harness-home.ts'
import { log } from './log.ts'

/** Automations live on the host that runs them (Orca: the execution host owns the scheduler). */
const DIR = join(HARNESS_HOME, 'automations')
const FILE = join(DIR, 'automations.json')
/** Orca bounds run history per automation; older runs are pruned. */
export const RUNS_KEPT_PER_AUTOMATION = 50

interface SavedAutomations {
  automations: Automation[]
  runs: AutomationRun[]
}

export async function loadAutomations(): Promise<SavedAutomations> {
  try {
    const parsed: unknown = JSON.parse(await readFile(FILE, 'utf8'))
    if (typeof parsed !== 'object' || parsed === null) return { automations: [], runs: [] }
    const automations = 'automations' in parsed && Array.isArray(parsed.automations) ? parsed.automations : []
    const runs = 'runs' in parsed && Array.isArray(parsed.runs) ? parsed.runs : []
    // SAFETY: written only by saveAutomations below, from these same types.
    return { automations: automations as Automation[], runs: runs as AutomationRun[] }
  } catch {
    return { automations: [], runs: [] }
  }
}

let queue: Promise<void> = Promise.resolve()

/** Serialized and written through a temp file, so a crash never leaves half a file. */
export function saveAutomations(data: SavedAutomations): Promise<void> {
  queue = queue
    .then(async () => {
      await mkdir(DIR, { recursive: true })
      const temp = `${FILE}.tmp`
      await writeFile(temp, JSON.stringify(data, null, 2))
      await rename(temp, FILE)
    })
    .catch((error) => log(`saving automations failed: ${String(error)}`))
  return queue
}
