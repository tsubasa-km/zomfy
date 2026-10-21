import { isTauri } from '@tauri-apps/api/core'
import type { TerminalShellKind } from '@acp-harness/protocol'
import type { HostId } from '@/session-store'

// Dropping files on a terminal types their paths, quoted for its shell, as Orca's terminal drop
// handler. Paths come from this computer, so a WSL host gets them in its own Linux form.

/** Orca's shellEscapePath: bare when safe, else quoted for the shell family. */
export function shellEscapePath(path: string, shell: TerminalShellKind): string {
  if (shell !== 'posix') return /^[a-zA-Z0-9_./@:\\-]+$/.test(path) ? path : `"${path}"`
  if (/^[a-zA-Z0-9_./@:-]+$/.test(path)) return path
  return `'${path.replace(/'/g, "'\\''")}'`
}

/** A path on this Windows machine as the given host sees it. */
export function hostDropPath(path: string, hostId: HostId): string {
  if (!hostId.startsWith('wsl:')) return path
  const unc = /^\\\\wsl(?:\.localhost|\$)\\[^\\]+(\\.*)?$/i.exec(path)
  if (unc) return (unc[1] ?? '\\').replaceAll('\\', '/')
  const drive = /^([A-Za-z]):[\\/](.*)$/.exec(path)
  if (drive) return `/mnt/${drive[1]!.toLowerCase()}/${drive[2]!.replaceAll('\\', '/')}`
  return path
}

export function dropPathsText(paths: string[], shell: TerminalShellKind, hostId: HostId): string {
  return paths.map((p) => `${shellEscapePath(hostDropPath(p, hostId), shell)} `).join('')
}

/** Paths an HTML drop carries: file:// URIs, or a path dragged from inside the app. */
export function pathsFromDataTransfer(data: DataTransfer): string[] {
  const uris = data.getData('text/uri-list')
  if (uris) {
    return uris
      .split(/\r?\n/)
      .filter((line) => line.startsWith('file://'))
      .map((uri) => {
        const path = decodeURIComponent(new URL(uri).pathname)
        return /^\/[A-Za-z]:\//.test(path) ? path.slice(1).replaceAll('/', '\\') : path
      })
  }
  const text = data.getData('text/plain').trim()
  return text && !text.includes('\n') ? [text] : []
}

// The OS drop arrives once per window through Tauri with physical coordinates; it is routed to
// the terminal under the pointer.
const dropTargets = new Map<string, (paths: string[]) => void>()
let nativeDropListening = false

export function registerTerminalDropTarget(terminalId: string, onPaths: (paths: string[]) => void): () => void {
  dropTargets.set(terminalId, onPaths)
  if (!nativeDropListening && isTauri()) {
    nativeDropListening = true
    void import('@tauri-apps/api/webview').then(({ getCurrentWebview }) =>
      getCurrentWebview().onDragDropEvent(({ payload }) => {
        if (payload.type !== 'drop' || payload.paths.length === 0) return
        const scale = window.devicePixelRatio || 1
        const element = document.elementFromPoint(payload.position.x / scale, payload.position.y / scale)
        const id = element?.closest<HTMLElement>('[data-terminal-id]')?.dataset.terminalId
        if (id) dropTargets.get(id)?.(payload.paths)
      })
    )
  }
  return () => {
    if (dropTargets.get(terminalId) === onPaths) dropTargets.delete(terminalId)
  }
}
