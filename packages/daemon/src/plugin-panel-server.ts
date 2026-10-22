// Serves enabled plugins' panel documents to the desktop's sandboxed frames. A frame loaded from
// the app itself (srcdoc) would inherit the app's CSP, which rightly forbids inline scripts; served
// from here the panel gets Orca's own panel CSP instead: inline code, no network, no navigation.
// Each URL carries an unguessable token issued for one panel read.

export const PLUGIN_PANEL_PATH_PREFIX = '/plugin-panel/'

const PANEL_CSP =
  "default-src 'none'; connect-src 'none'; script-src 'unsafe-inline'; " +
  "style-src 'unsafe-inline'; img-src data:; font-src data:; base-uri 'none'; form-action 'none'"
const TOKEN_TTL_MS = 30 * 60_000
const MAX_TOKENS = 64

// Wire names from Orca's shared/plugins/plugin-panel-bridge.ts.
const PANEL_PING_TYPE = 'orca-panel-ping'
const PANEL_PONG_TYPE = 'orca-panel-pong'

export interface PanelTheme {
  scheme: 'dark' | 'light'
  /** `--token:value;` declarations from the app's own stylesheet. */
  tokensCss: string
}

/** Orca's plugin-panel-shell.ts prelude: CSP first, then design tokens and the ping responder. */
function panelDocument(pluginHtml: string, theme: PanelTheme): string {
  const tokens = theme.tokensCss.replace(/[<>{}]/g, '')
  return (
    '<!doctype html>\n' +
    `<html class="${theme.scheme === 'dark' ? 'dark' : 'light'}">\n<head>\n<meta charset="utf-8">\n` +
    `<meta http-equiv="Content-Security-Policy" content="${PANEL_CSP}">\n` +
    `<style>:root{${tokens}color-scheme:${theme.scheme === 'dark' ? 'dark' : 'light'}}</style>\n` +
    '<script>\n' +
    "'use strict'\n" +
    "try { Object.defineProperty(window, 'open', { value: function () { return null }, writable: false, configurable: false }) } catch (_) {}\n" +
    // Panels are documents, never browsing contexts: links and forms go nowhere.
    "window.addEventListener('click', function (event) {\n" +
    '  for (var node = event.target; node && node !== document; node = node.parentNode) {\n' +
    "    if (node.nodeType === 1 && node.tagName === 'A' && node.hasAttribute('href')) { event.preventDefault(); event.stopImmediatePropagation(); return }\n" +
    '  }\n' +
    '}, true)\n' +
    "window.addEventListener('submit', function (event) { event.preventDefault(); event.stopImmediatePropagation() }, true)\n" +
    "window.addEventListener('message', function (event) {\n" +
    `  if (event.source === window.parent && event.data && event.data.type === '${PANEL_PING_TYPE}') {\n` +
    `    window.parent.postMessage({ type: '${PANEL_PONG_TYPE}', pingId: event.data.pingId }, '*')\n` +
    '  }\n' +
    '})\n' +
    '</script>\n</head>\n' +
    pluginHtml
  )
}

class PluginPanelServer {
  private documents = new Map<string, { html: string; expires: number }>()

  /** Returns the path the frame loads. */
  issue(pluginHtml: string, theme: PanelTheme): string {
    const now = Date.now()
    for (const [token, doc] of this.documents) if (doc.expires < now) this.documents.delete(token)
    while (this.documents.size >= MAX_TOKENS) this.documents.delete(this.documents.keys().next().value!)
    const token = Buffer.from(crypto.getRandomValues(new Uint8Array(24))).toString('hex')
    this.documents.set(token, { html: panelDocument(pluginHtml, theme), expires: now + TOKEN_TTL_MS })
    return `${PLUGIN_PANEL_PATH_PREFIX}${token}`
  }

  handleHttp(req: Request): Response {
    const token = new URL(req.url).pathname.slice(PLUGIN_PANEL_PATH_PREFIX.length)
    const doc = this.documents.get(token)
    if (req.method !== 'GET' || !doc || doc.expires < Date.now()) return new Response('not found', { status: 404 })
    return new Response(doc.html, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Security-Policy': PANEL_CSP,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer'
      }
    })
  }
}

export const pluginPanels = new PluginPanelServer()
