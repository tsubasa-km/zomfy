import { cp, lstat, mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join, posix } from 'node:path'
import type { DeleteResult } from '@acp-harness/protocol'
import { resolveInside } from './workspace-files.ts'
import { moveToTrash } from './host-trash.ts'

// Explorer mutations (Orca's useFileExplorerInlineInput, useFileDeletion, useFileDuplicate,
// useFileExplorerMoveDrop). Every path is checked against the workspace root first.

/** A path that may not exist yet: its parent must resolve inside the workspace and its name be plain. */
async function resolveNewInside(root: string, relativePath: string): Promise<string> {
  const normalized = posix.normalize(relativePath.replaceAll('\\', '/')).replace(/\/+$/, '')
  const name = posix.basename(normalized)
  if (!name || name === '.' || name === '..' || name.includes('\0') || normalized.startsWith('../')) {
    throw new Error(`Invalid path: ${relativePath}`)
  }
  const parent = await resolveInside(root, posix.dirname(normalized))
  return join(parent, name)
}

/** Existing entry inside the workspace, never the root itself; a symlink is the link, not its target. */
async function resolveEntry(root: string, relativePath: string): Promise<string> {
  const absolute = await resolveNewInside(root, relativePath)
  await lstat(absolute)
  return absolute
}

async function exists(path: string): Promise<boolean> {
  return lstat(path).then(
    () => true,
    () => false
  )
}

export async function createEntry(root: string, path: string, kind: 'file' | 'dir'): Promise<void> {
  const absolute = await resolveNewInside(root, path)
  if (await exists(absolute)) throw new Error(`${basename(absolute)} already exists`)
  if (kind === 'dir') await mkdir(absolute)
  else await writeFile(absolute, '', { flag: 'wx' })
}

export async function renameEntry(root: string, from: string, to: string): Promise<void> {
  const source = await resolveEntry(root, from)
  const target = await resolveNewInside(root, to)
  if (source === target) return
  const toPosix = (p: string) => p.replaceAll('\\', '/')
  if (toPosix(target).startsWith(`${toPosix(source)}/`)) throw new Error('Cannot move a folder into itself')
  // A case-only rename on a case-insensitive disk sees the target as "existing".
  const caseOnly = source.toLowerCase() === target.toLowerCase()
  if (!caseOnly && (await exists(target))) throw new Error(`${basename(target)} already exists`)
  await rename(source, target)
}

export async function deleteEntries(root: string, paths: string[], permanent: boolean): Promise<DeleteResult> {
  if (!permanent) {
    const targets = await Promise.all(paths.map((p) => resolveEntry(root, p)))
    for (const target of targets) {
      const outcome = await moveToTrash(target)
      // Entries already trashed stay there; the permanent retry skips them as missing.
      if (outcome !== true) return { status: 'trash-unavailable', reason: outcome }
    }
    return { status: 'trashed' }
  }
  for (const path of paths) {
    const target = await resolveEntry(root, path).catch((e: NodeJS.ErrnoException) => {
      if (e.code === 'ENOENT') return null
      throw e
    })
    if (target) await rm(target, { recursive: true, force: true })
  }
  return { status: 'deleted' }
}

/** Orca's "stem copy.ext", "stem copy 2.ext", … next to the original. */
export async function duplicateEntry(root: string, path: string): Promise<{ path: string }> {
  const source = await resolveEntry(root, path)
  const isDir = (await lstat(source)).isDirectory()
  const ext = isDir ? '' : extname(source)
  const stem = basename(source, ext)
  const dir = dirname(source)
  for (let n = 1; n < 1000; n++) {
    const name = `${stem} copy${n === 1 ? '' : ` ${n}`}${ext}`
    const candidate = join(dir, name)
    if (await exists(candidate)) continue
    await cp(source, candidate, { recursive: true, errorOnExist: true, force: false, verbatimSymlinks: true })
    return { path: posix.join(posix.dirname(path), name) }
  }
  throw new Error(`Too many copies of ${basename(source)}`)
}
