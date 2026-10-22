import { isTauri } from '@tauri-apps/api/core'
import { openUrl } from '@tauri-apps/plugin-opener'
import { getState, openEditorTab } from '@/session-store'
import { openBrowserTab, workspacePath } from '@/components/tab-layout/workspace-tab-model'
import { IS_MAC } from '@/keybindings/keybinding-chords'
import { classifyLinkHref, workspaceRelativePath, type LinkTarget } from './link-targets'

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
      if (!workspaceId) return
      const path = workspaceRelativePath(target.path, workspacePath(workspaceId))
      // Outside the workspace the editor cannot read it; better nothing than a broken tab.
      if (path === null) return
      openEditorTab({ workspaceId, kind: 'file', path, staged: false, ...(target.line ? { line: target.line } : {}) })
      return
    }
    case 'anchor':
    case 'blocked':
      return
  }
}

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
