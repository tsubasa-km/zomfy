import { useSyncExternalStore } from 'react'

/** An in-app browser tab; like editor tabs, it lives only in this window. */
export interface BrowserTab {
  id: string
  workspaceId: string
  createdAt: number
  /** Addresses this tab navigated to; a cross-origin frame hides its own link clicks. */
  history: string[]
  historyIndex: number
  /** Bumped by Reload so the frame remounts even when the URL is unchanged. */
  reloadKey: number
}

export const BLANK_URL = 'about:blank'

const STORAGE_KEY = 'acp-harness.browser-tabs.v1'

function readSaved(): BrowserTab[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')
    return Array.isArray(raw) ? (raw as BrowserTab[]) : []
  } catch {
    return []
  }
}

let tabs: BrowserTab[] = readSaved()
const listeners = new Set<() => void>()

function commit(next: BrowserTab[]): void {
  tabs = next
  for (const listener of listeners) listener()
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    // Storage can be unavailable; browser tabs then do not survive a restart.
  }
}

export function useBrowserTabs(): BrowserTab[] {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => tabs
  )
}

export function getBrowserTabs(): BrowserTab[] {
  return tabs
}

export function currentUrl(tab: BrowserTab): string {
  return tab.history[tab.historyIndex] ?? BLANK_URL
}

export function addBrowserTab(workspaceId: string, url: string = BLANK_URL): BrowserTab {
  const tab: BrowserTab = {
    id: `browser:${crypto.randomUUID()}`,
    workspaceId,
    createdAt: Date.now(),
    history: [url],
    historyIndex: 0,
    reloadKey: 0
  }
  commit([...tabs, tab])
  return tab
}

export function removeBrowserTabs(ids: string[]): void {
  const gone = new Set(ids)
  if (tabs.some((t) => gone.has(t.id))) commit(tabs.filter((t) => !gone.has(t.id)))
}

function update(id: string, change: (tab: BrowserTab) => BrowserTab): void {
  commit(tabs.map((t) => (t.id === id ? change(t) : t)))
}

export function navigateBrowserTab(id: string, url: string): void {
  update(id, (t) => {
    const history = [...t.history.slice(0, t.historyIndex + 1), url]
    return { ...t, history, historyIndex: history.length - 1 }
  })
}

export function stepBrowserHistory(id: string, delta: -1 | 1): void {
  update(id, (t) => ({ ...t, historyIndex: Math.max(0, Math.min(t.history.length - 1, t.historyIndex + delta)) }))
}

export function reloadBrowserTab(id: string): void {
  update(id, (t) => ({ ...t, reloadKey: t.reloadKey + 1 }))
}

// Address bar input → URL, after Orca's normalizeBrowserNavigationUrl (shared/browser-url.ts).
const LOCAL_ADDRESS = /^(?:localhost|127(?:\.\d{1,3}){3}|0\.0\.0\.0|\[[0-9a-f:]+\])(?::\d+)?(?:[/?#].*)?$/i
const LOOKS_LIKE_URL = /^[^\s]+\.[a-z]{2,}(\/.*)?$/i
const SEARCH_URL = 'https://www.google.com/search?q='

function looksLikeSearchQuery(input: string): boolean {
  if (input.includes(' ')) return true
  if (LOOKS_LIKE_URL.test(input)) return false
  return !(input.includes('.') || input.includes(':'))
}

export function normalizeAddress(raw: string): string {
  const trimmed = raw.trim()
  if (trimmed === '' || trimmed === BLANK_URL) return BLANK_URL
  if (LOCAL_ADDRESS.test(trimmed)) return new URL(`http://${trimmed}`).toString()
  try {
    const parsed = new URL(trimmed)
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return parsed.toString()
  } catch {
    // Not absolute; fall through to https:// or search.
  }
  if (!looksLikeSearchQuery(trimmed)) {
    try {
      return new URL(`https://${trimmed}`).toString()
    } catch {
      // Not a host either; search for it.
    }
  }
  return `${SEARCH_URL}${encodeURIComponent(trimmed)}`
}

export function browserTabTitle(tab: BrowserTab): string {
  const url = currentUrl(tab)
  if (url === BLANK_URL) return 'New Tab'
  try {
    const parsed = new URL(url)
    return parsed.host || url
  } catch {
    return url
  }
}
