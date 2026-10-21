import { openWorkspaceIn } from '@/components/sidebar/WorkspaceMenu'
import type { HostId } from '@/session-store'

// Workspace-relative explorer paths are '/'-separated; absolute ones use the host's own separator.

export function parentDir(path: string): string {
  const slash = path.lastIndexOf('/')
  return slash < 0 ? '' : path.slice(0, slash)
}

export function baseName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}

export function joinPath(dir: string, name: string): string {
  return dir ? `${dir}/${name}` : name
}

/** True when `path` is `dir` or inside it. */
export function isWithin(path: string, dir: string): boolean {
  return dir === '' || path === dir || path.startsWith(`${dir}/`)
}

export function ancestorsOf(path: string): string[] {
  const dirs: string[] = []
  for (let dir = parentDir(path); dir; dir = parentDir(dir)) dirs.unshift(dir)
  return dirs
}

export function absolutePath(workspacePath: string, relative: string): string {
  if (!relative) return workspacePath
  const sep = workspacePath.includes('\\') ? '\\' : '/'
  return `${workspacePath.replace(/[\\/]+$/, '')}${sep}${relative.replaceAll('/', sep)}`
}

export function copyText(text: string): void {
  // The clipboard can reject while the window is unfocused; nothing to recover.
  void navigator.clipboard.writeText(text).catch(() => undefined)
}

const platform = navigator.userAgent

/** Orca's getRevealInFileManagerLabel. */
export const REVEAL_LABEL = platform.includes('Mac')
  ? 'Reveal in Finder'
  : platform.includes('Windows')
    ? 'Reveal in File Explorer'
    : 'Open Containing Folder'

/** Opens the folder that holds an entry (or the folder itself) in the host's file manager. */
export function revealInFileManager(hostId: HostId, workspacePath: string, relative: string, isDir: boolean): void {
  openWorkspaceIn('explorer', hostId, absolutePath(workspacePath, isDir ? relative : parentDir(relative)))
}
