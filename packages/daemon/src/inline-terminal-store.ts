import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { TerminalInfo } from '@acp-harness/protocol'
import { HARNESS_HOME } from './harness-home.ts'
import { log } from './log.ts'

/** Terminals under chat code blocks, kept so a restarted host still shows what their runs printed. */
const DIR = join(HARNESS_HOME, 'inline-terminals')

export interface SavedInlineTerminal {
  info: TerminalInfo
  replay: string
}

function fileOf(terminalId: string): string {
  if (!/^[\w-]+$/.test(terminalId)) throw new Error('Invalid terminal id')
  return join(DIR, `${terminalId}.json`)
}

export async function loadInlineTerminals(): Promise<SavedInlineTerminal[]> {
  const names = await readdir(DIR).catch(() => [])
  const saved: SavedInlineTerminal[] = []
  for (const name of names.filter((n) => n.endsWith('.json'))) {
    try {
      // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: written by saveInlineTerminal.
      saved.push(JSON.parse(await readFile(join(DIR, name), 'utf8')) as SavedInlineTerminal)
    } catch (error) {
      log(`skipping inline terminal ${name}: ${error}`)
    }
  }
  return saved
}

export async function saveInlineTerminal(saved: SavedInlineTerminal): Promise<void> {
  await mkdir(DIR, { recursive: true })
  const path = fileOf(saved.info.id)
  const temp = `${path}.${process.pid}.tmp`
  await writeFile(temp, JSON.stringify(saved))
  await rename(temp, path)
}

export async function forgetInlineTerminal(terminalId: string): Promise<void> {
  await rm(fileOf(terminalId), { force: true })
}
