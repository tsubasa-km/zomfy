import { readFile, stat } from 'node:fs/promises'
import type { FileBinaryContent, FileRevisionContent, FileRevisionParams, FileStat } from '@acp-harness/protocol'
import { resolveInside } from './workspace-files.ts'

/** Images and PDFs past this are refused rather than shipped over the socket. */
const BINARY_READ_LIMIT = 50 * 1024 * 1024
const TEXT_REVISION_LIMIT = 5 * 1024 * 1024

export async function readWorkspaceFileBinary(root: string, path: string): Promise<FileBinaryContent> {
  const absolute = await resolveInside(root, path)
  const info = await stat(absolute)
  if (!info.isFile()) throw new Error(`${path} is not a file`)
  if (info.size > BINARY_READ_LIMIT) throw new Error(`${path} is larger than 50 MB`)
  const bytes = await readFile(absolute)
  return { path, base64: bytes.toString('base64'), size: info.size, mtimeMs: info.mtimeMs }
}

export async function statWorkspaceFile(root: string, path: string): Promise<FileStat> {
  const absolute = await resolveInside(root, path)
  const info = await stat(absolute).catch(() => null)
  return info?.isFile()
    ? { exists: true, mtimeMs: info.mtimeMs, size: info.size }
    : { exists: false, mtimeMs: 0, size: 0 }
}

/** `git show` of the committed or staged copy; a path missing there is `exists: false`, not an error. */
export async function readWorkspaceFileRevision(root: string, params: FileRevisionParams): Promise<FileRevisionContent> {
  await resolveInside(root, params.path)
  // `./` keeps the path relative to the workspace even when it is a repository subdirectory.
  // A leading dash would read as a git option.
  if (!/^[w./~^-]+$/.test(params.revision) || params.revision.startsWith('-')) {
    throw new Error(`Invalid revision ${params.revision}`)
  }
  const spec = `${params.revision === 'index' ? '' : params.revision}:./${params.path}`
  const proc = Bun.spawn(['git', 'show', spec], {
    cwd: root,
    stdout: 'pipe',
    stderr: 'pipe',
    windowsHide: true,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }
  })
  const [bytes, code] = await Promise.all([new Response(proc.stdout).arrayBuffer(), proc.exited])
  const missing: FileRevisionContent = {
    path: params.path,
    revision: params.revision,
    exists: false,
    binary: false,
    content: ''
  }
  if (code !== 0) return missing
  const buffer = Buffer.from(bytes)
  const binary = buffer.subarray(0, 8192).includes(0)
  if (params.encoding === 'base64') {
    return { ...missing, exists: true, binary, content: buffer.toString('base64') }
  }
  if (binary || buffer.length > TEXT_REVISION_LIMIT) return { ...missing, exists: true, binary: true }
  return { ...missing, exists: true, content: buffer.toString('utf8') }
}
