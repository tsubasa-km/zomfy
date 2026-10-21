import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { git, isGitRepository } from './git-cli.ts'

const MAX_FILES = 20_000
const SKIPPED_DIRS = new Set(['.git', 'node_modules', 'dist', 'build', 'target', '.next', '.venv'])

/** Workspace files the composer's @ menu offers: git's view when it has one, else a bounded walk. */
export async function mentionFiles(root: string): Promise<string[]> {
  if (await isGitRepository(root)) {
    const out = await git(root, ['ls-files', '--cached', '--others', '--exclude-standard'])
    return [...new Set(out.split('\n').filter(Boolean))].slice(0, MAX_FILES)
  }
  const files: string[] = []
  const pending = ['']
  while (pending.length > 0 && files.length < MAX_FILES) {
    const dir = pending.shift() ?? ''
    const entries = await readdir(join(root, dir), { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      const path = dir ? `${dir}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRS.has(entry.name)) pending.push(path)
      } else if (entry.isFile()) {
        files.push(path)
      }
    }
  }
  return files
}
