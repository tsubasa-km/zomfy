import { isTauri } from '@tauri-apps/api/core'
import { openUrl } from '@tauri-apps/plugin-opener'
import { toast } from 'sonner'
import { LOCAL_HOST, allWorkspaces, findWorkspace, getState, openEditorTab, whenState, type HostId } from '@/session-store'
import { isSshHost } from '@/daemon-connection'
import { workspaceHost } from '@/lib/host-lists'
import { t } from '@/i18n/i18n'
import { openWorkspaceIn } from '@/components/sidebar/WorkspaceMenu'
import { openBrowserTab, workspacePath } from '@/components/tab-layout/workspace-tab-model'
import { IS_MAC } from '@/keybindings/keybinding-chords'
import { classifyLinkHref, containingWorkspace, isAbsolutePath, workspaceRelativePath, type LinkTarget } from './link-targets'

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
    case 'file':
      void openFileLink(target, options.workspaceId)
      return
    case 'anchor':
    case 'blocked':
      return
  }
}

/** How long a link waits for its chat's host to list its workspaces (still connecting). */
const HOST_LISTING_WAIT_MS = 20_000

/**
 * A path in the editor: relative to the chat's workspace, or a full path inside it or inside
 * another workspace of the same host (the project's main checkout, a sibling worktree).
 */
async function openFileLink(target: Extract<LinkTarget, { kind: 'file' }>, workspaceId: string | null): Promise<void> {
  // A workspace on a host still connecting has no root yet; its paths are not "outside" it.
  if (workspaceId && workspaceHost(getState().hosts, workspaceId, LOCAL_HOST) === 'pending') {
    await whenState((s) => workspaceHost(s.hosts, workspaceId, LOCAL_HOST) !== 'pending', HOST_LISTING_WAIT_MS)
  }
  const line = target.line ? { line: target.line } : {}
  const path = workspaceId ? workspaceRelativePath(target.path, workspacePath(workspaceId)) : null
  if (workspaceId && path !== null) {
    openEditorTab({ workspaceId, kind: 'file', path, staged: false, ...line })
    return
  }
  const hostId = (workspaceId ? findWorkspace(workspaceId)?.hostId : null) ?? LOCAL_HOST
  const other = containingWorkspace(target.path, allWorkspaces(getState()).filter((w) => w.hostId === hostId))
  if (other) {
    openEditorTab({ workspaceId: other.workspaceId, kind: 'file', path: other.path, staged: false, ...line })
    return
  }
  // The editor reads only the workspaces' files; one elsewhere goes to the OS.
  openOutsideWorkspace(target.path, workspaceId)
}

/**
 * A full path outside the workspace, shown selected in the file manager. It is never handed to the
 * app the OS opens it with, so a click on a path an agent wrote never starts a program. Where it
 * cannot be shown (another computer's file, a preview without a file manager) the click says so
 * rather than doing nothing.
 */
function openOutsideWorkspace(path: string, workspaceId: string | null): void {
  const cannot = (): void => {
    toast.info(t('{path} is outside the workspace, so it cannot be opened here.', { path }))
  }
  if (!isTauri() || !isAbsolutePath(path)) return cannot()
  const workspace = workspaceId ? findWorkspace(workspaceId) : null
  let hostId: HostId = LOCAL_HOST
  if (path.startsWith('/')) {
    // A POSIX path is the workspace's host's own: WSL's, or this computer's where it is not Windows.
    hostId = workspace?.hostId ?? LOCAL_HOST
    if (isSshHost(hostId) || (hostId === LOCAL_HOST && IS_WINDOWS)) return cannot()
  }
  openWorkspaceIn('reveal', hostId, path)
}

const IS_WINDOWS = navigator.userAgent.includes('Windows')

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
