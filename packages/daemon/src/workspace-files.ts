import { chmod, open, readdir, realpath, rename, stat, writeFile } from 'node:fs/promises'
import { join, relative, resolve, sep } from 'node:path'
import type { FileContent, FileEntry } from '@acp-harness/protocol'

/** Previews stop here; larger files open truncated. */
const READ_LIMIT = 1024 * 1024
const HIDDEN = new Set(['.git'])

/** Resolves a workspace-relative path, refusing anything that escapes the workspace root. */
export async function resolveInside(root: string, relativePath: string): Promise<string> {
  const absolute = resolve(root, relativePath || '.')
  const realRoot = await realpath(root)
  const real = await realpath(absolute).catch(() => absolute)
  const rel = relative(realRoot, real)
  if (rel.startsWith('..') || resolve(realRoot, rel) !== real) {
    throw new Error(`${relativePath} is outside the workspace`)
  }
  return absolute
}

export async function listDirectory(root: string, dir: string): Promise<FileEntry[]> {
  const absolute = await resolveInside(root, dir)
  const entries = await readdir(absolute, { withFileTypes: true })
  return entries
    .filter((e) => !HIDDEN.has(e.name))
    .map((e): FileEntry => ({
      name: e.name,
      path: toPosix(relative(root, join(absolute, e.name))),
      kind: e.isSymbolicLink() ? 'symlink' : e.isDirectory() ? 'dir' : 'file'
    }))
    .sort((a, b) =>
      a.kind === 'dir' && b.kind !== 'dir'
        ? -1
        : b.kind === 'dir' && a.kind !== 'dir'
          ? 1
          : a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
    )
}

export async function readWorkspaceFile(root: string, path: string): Promise<FileContent> {
  const absolute = await resolveInside(root, path)
  const info = await stat(absolute)
  if (!info.isFile()) throw new Error(`${path} is not a file`)
  const handle = await open(absolute, 'r')
  try {
    const length = Math.min(info.size, READ_LIMIT)
    const buffer = Buffer.alloc(length)
    await handle.read(buffer, 0, length, 0)
    // A NUL in the first 8 KB is git's own binary heuristic.
    const binary = buffer.subarray(0, 8192).includes(0)
    return {
      path,
      content: binary ? '' : buffer.toString('utf8'),
      binary,
      truncated: info.size > READ_LIMIT,
      mtimeMs: info.mtimeMs
    }
  } finally {
    await handle.close()
  }
}

/** Saves through a temp file and rename, refusing when the file changed after the editor read it. */
export async function writeWorkspaceFile(
  root: string,
  path: string,
  content: string,
  expectedMtimeMs?: number
): Promise<{ mtimeMs: number }> {
  const absolute = await resolveInside(root, path)
  const current = await stat(absolute).catch(() => null)
  if (current && expectedMtimeMs !== undefined && Math.abs(current.mtimeMs - expectedMtimeMs) > 1) {
    throw new Error(`${path} changed on disk since it was opened; reload it before saving`)
  }
  const temp = `${absolute}.acp-harness-${process.pid}.tmp`
  await writeFile(temp, content)
  // Keep the executable bit and other mode flags the original had.
  if (current) await chmod(temp, current.mode & 0o7777).catch(() => undefined)
  await rename(temp, absolute)
  return { mtimeMs: (await stat(absolute)).mtimeMs }
}

function toPosix(path: string): string {
  return sep === '\\' ? path.replaceAll('\\', '/') : path
}
