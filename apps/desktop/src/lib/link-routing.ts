import { isTauri } from '@tauri-apps/api/core'
import { openUrl } from '@tauri-apps/plugin-opener'
import { LOCAL_HOST, findWorkspace, getState, openEditorTab, type HostId } from '@/session-store'
import { isSshHost } from '@/daemon-connection'
import { openWorkspaceIn } from '@/components/sidebar/WorkspaceMenu'
import { openBrowserTab, workspacePath } from '@/components/tab-layout/workspace-tab-model'
import { IS_MAC } from '@/keybindings/keybinding-chords'
import { classifyLinkHref, isAbsolutePath, workspaceRelativePath, type LinkTarget } from './link-targets'

// One route for every link the app shows, as Orca's http-link-routing: http(s) goes to the system
// browser, Mod+click to an in-app browser tab, paths to the editor. The webview itself never
// navigates or opens windows; Tauri gives it no opener, so an unrouted click would do nothing.

/** Marks a subtree whose path links its component resolves itself (the markdown preview). */
export const SELF_ROUTED_PATHS_ATTR = 'data-link-paths-self'
/** Set on a container (a chat) whose links belong to that workspace rather than the active one. */
export const LINK_WORKSPACE_ATTR = 'data-link-workspace-id'

const nativeWindowOpen = window.open.bind(window)

export function isLinkModifier(event: Pick<MouseEvent, 'metaKey' | 'ctrlKey'>): boolean {
  return IS_MAC ? event.metaKey : event.ctrlKey
}

/** The system browser in the app; a new browser tab in the preview, which has no opener. */
export function openExternalUrl(url: string): void {
  if (!isTauri()) {
    nativeWindowOpen(url, '_blank', 'noopener')
    return
  }
  void openUrl(url).catch(() => undefined)
}

export function openLinkTarget(target: LinkTarget, options: { inApp: boolean; workspaceId: string | null }): void {
  switch (target.kind) {
    case 'web':
      if (options.inApp && options.workspaceId) openBrowserTab(options.workspaceId, target.url)
      else openExternalUrl(target.url)
      return
    case 'system':
      openExternalUrl(target.url)
      return
    case 'file': {
      const { workspaceId } = options
      const path = workspaceId ? workspaceRelativePath(target.path, workspacePath(workspaceId)) : null
      if (workspaceId && path !== null) {
        openEditorTab({ workspaceId, kind: 'file', path, staged: false, ...(target.line ? { line: target.line } : {}) })
        return
      }
      // The editor reads only the workspace's files; one elsewhere goes to the OS.
      openOutsideWorkspace(target.path, workspaceId)
      return
    }
    case 'anchor':
    case 'blocked':
      return
  }
}

/**
 * A full path outside the workspace, opened as the file manager would open it: a folder in the file
 * manager, a file in its app. Anything that could run is only shown selected in its folder, so a
 * click on a path an agent wrote never starts a program.
 */
function openOutsideWorkspace(path: string, workspaceId: string | null): void {
  if (!isTauri() || !isAbsolutePath(path)) return
  const workspace = workspaceId ? findWorkspace(workspaceId) : null
  let hostId: HostId = LOCAL_HOST
  if (path.startsWith('/')) {
    // A POSIX path is the workspace's host's own: WSL's, or this computer's where it is not Windows.
    hostId = workspace?.hostId ?? LOCAL_HOST
    if (isSshHost(hostId) || (hostId === LOCAL_HOST && IS_WINDOWS)) return
  }
  openWorkspaceIn(RUNNABLE_RE.test(path) ? 'reveal' : 'default', hostId, path)
}

const IS_WINDOWS = navigator.userAgent.includes('Windows')
// What Windows (or a desktop) would run rather than show when handed the file.
const RUNNABLE_RE =
  /\.(exe|com|bat|cmd|ps1|psm1|vbs|vbe|js|jse|wsf|wsh|hta|msi|msp|scr|pif|cpl|reg|lnk|url|jar|py|pyw|sh|bash|zsh|command|app|appimage|desktop|run|bin|deb|rpm|dmg|pkg)$/i

export function openHref(href: string, options: { inApp: boolean; workspaceId?: string | null }): void {
  openLinkTarget(classifyLinkHref(href), { inApp: options.inApp, workspaceId: options.workspaceId ?? getState().activeWorkspaceId })
}

function onLinkClick(event: MouseEvent): void {
  if (event.button !== 0 && event.button !== 1) return
  const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null
  if (!(anchor instanceof HTMLAnchorElement)) return
  const href = anchor.getAttribute('href') ?? ''
  const target = classifyLinkHref(href)
  if (target.kind === 'anchor') return
  if (target.kind === 'file' && anchor.closest(`[${SELF_ROUTED_PATHS_ATTR}]`)) return
  event.preventDefault()
  const scoped = anchor.closest(`[${LINK_WORKSPACE_ATTR}]`)?.getAttribute(LINK_WORKSPACE_ATTR)
  openLinkTarget(target, {
    inApp: isLinkModifier(event),
    workspaceId: scoped || getState().activeWorkspaceId
  })
}

let installed = false

/**
 * Capture phase, so a component that stops propagation cannot leave the default action to
 * navigate the app's own webview away. Also routes window.open, which panels call for links.
 */
export function installLinkRouting(): void {
  if (installed) return
  installed = true
  window.addEventListener('click', onLinkClick, true)
  window.addEventListener('auxclick', onLinkClick, true)
  window.open = (url?: string | URL, target?: string, features?: string) => {
    const href = url === undefined ? '' : String(url)
    const classified = classifyLinkHref(href)
    if (isTauri() && (classified.kind === 'web' || classified.kind === 'system')) {
      openExternalUrl(classified.url)
      return null
    }
    return nativeWindowOpen(url, target, features)
  }
}
