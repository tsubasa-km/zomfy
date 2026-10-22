// Wire names from Orca's shared/plugins/plugin-panel-bridge.ts, so a panel written for Orca's
// postMessage bridge runs unchanged. The document itself is built and served by the local daemon
// (plugin-panel-server.ts) under the panel CSP.

export const PANEL_ACTION_REQUEST_TYPE = 'orca-panel-action'
export const PANEL_ACTION_RESULT_TYPE = 'orca-panel-action-result'

export const PANEL_MESSAGE_MAX_BYTES = 64 * 1024
export const PANEL_MESSAGE_RATE_LIMIT = { maxMessages: 30, perMs: 10_000 }

/** Orca's curated token subset; growing it is additive, renaming one breaks plugins. */
const PANEL_DESIGN_TOKENS = [
  '--background',
  '--foreground',
  '--card',
  '--card-foreground',
  '--popover',
  '--popover-foreground',
  '--primary',
  '--primary-foreground',
  '--secondary',
  '--secondary-foreground',
  '--muted',
  '--muted-foreground',
  '--accent',
  '--accent-foreground',
  '--destructive',
  '--destructive-foreground',
  '--border',
  '--input',
  '--ring',
  '--radius'
] as const

/** The app's current scheme and token values, baked into the panel document. */
export function panelTheme(): { scheme: 'dark' | 'light'; tokensCss: string } {
  const style = getComputedStyle(document.documentElement)
  const tokensCss = PANEL_DESIGN_TOKENS.map((token) => {
    const value = style.getPropertyValue(token).trim()
    return value ? `${token}:${value};` : ''
  }).join('')
  return { scheme: document.documentElement.classList.contains('dark') ? 'dark' : 'light', tokensCss }
}
