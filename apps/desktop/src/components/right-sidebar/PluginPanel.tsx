import { useEffect, useRef, useState } from 'react'
import { isTauri } from '@tauri-apps/api/core'
import { isPermissionGranted, requestPermission, sendNotification } from '@tauri-apps/plugin-notification'
import { HARNESS_METHODS, type PluginCapabilityKind } from '@acp-harness/protocol'
import { harnessRequest } from '@/daemon-connection'
import { LOCAL_HOST, findWorkspace, getState } from '@/session-store'
import { enabledPlugins, type ActivePluginPanel } from '@/plugins/plugin-registry'
import {
  PANEL_ACTION_REQUEST_TYPE,
  PANEL_ACTION_RESULT_TYPE,
  PANEL_MESSAGE_MAX_BYTES,
  PANEL_MESSAGE_RATE_LIMIT,
  panelTheme
} from '@/plugins/plugin-panel-shell'
import { t } from '@/i18n/i18n'

// Orca's right-sidebar PluginPanel + plugin-panel-bridge-host: the panel, served by the local daemon,
// in an opaque-origin sandboxed frame, answering the panel-callable host API the harness implements. Each call is
// checked against the capabilities the user consented to when enabling the plugin.

type Entry = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; src: string }

type ActionOutcome = { ok: true; value: unknown } | { ok: false; errorCode: string; error: string }

const ACTION_CAPABILITY: Record<string, PluginCapabilityKind> = {
  'workspace.readContext': 'workspace:read',
  'terminal.sendText': 'terminal:send',
  'notifications.show': 'notifications:show'
}

async function runAction(action: string, params: unknown, workspaceId: string, pluginName: string): Promise<ActionOutcome> {
  if (action === 'workspace.readContext') {
    const workspace = findWorkspace(workspaceId)
    if (!workspace) return { ok: false, errorCode: 'unavailable', error: 'No focused workspace' }
    const terminals = getState()
      .terminals.filter((t) => t.workspaceId === workspaceId)
      .map((t) => ({ id: t.id }))
    return { ok: true, value: { branch: workspace.branch ?? '', displayName: workspace.displayName ?? workspace.name, terminals } }
  }
  if (action === 'notifications.show') {
    const p = params && typeof params === 'object' ? (params as Record<string, unknown>) : {}
    const title = typeof p.title === 'string' ? p.title.slice(0, 120) : ''
    if (!title) return { ok: false, errorCode: 'invalid_params', error: 'title is required' }
    if (!isTauri()) return { ok: true, value: { delivered: false } }
    const granted = (await isPermissionGranted()) || (await requestPermission()) === 'granted'
    // Labelled with the plugin's name so a plugin cannot pose as the app.
    if (granted) sendNotification({ title: `${pluginName}: ${title}`, ...(typeof p.body === 'string' ? { body: p.body.slice(0, 1000) } : {}) })
    return { ok: true, value: { delivered: granted } }
  }
  // terminal.sendText types into a terminal; not offered to plugins in the harness yet.
  return { ok: false, errorCode: 'unavailable', error: `${action} is not available in acp-harness` }
}

/** The app's scheme; the frame is re-issued when it flips, so its baked-in tokens follow. */
function useAppScheme(): 'dark' | 'light' {
  const read = () => (document.documentElement.classList.contains('dark') ? 'dark' : 'light')
  const [scheme, setScheme] = useState<'dark' | 'light'>(read)
  useEffect(() => {
    const observer = new MutationObserver(() => setScheme(read()))
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [])
  return scheme
}

export function PluginPanel({ panel, workspaceId }: { panel: ActivePluginPanel; workspaceId: string }) {
  const [entry, setEntry] = useState<Entry>({ status: 'loading' })
  const frame = useRef<HTMLIFrameElement>(null)
  const scheme = useAppScheme()

  useEffect(() => {
    let current = true
    setEntry({ status: 'loading' })
    const connection = getState().hosts[LOCAL_HOST]?.connection
    if (connection?.kind !== 'connected') {
      setEntry({ status: 'error', message: t('This computer’s daemon is not connected') })
      return
    }
    harnessRequest(HARNESS_METHODS.pluginPanelRead, { pluginKey: panel.pluginKey, panelId: panel.id, theme: panelTheme() }, LOCAL_HOST).then(
      ({ path }) => {
        const base = new URL(connection.url)
        base.protocol = base.protocol === 'wss:' ? 'https:' : 'http:'
        if (current) setEntry({ status: 'ready', src: new URL(path, base).href })
      },
      (e: unknown) => current && setEntry({ status: 'error', message: e instanceof Error ? e.message : String(e) })
    )
    return () => {
      current = false
    }
  }, [panel.pluginKey, panel.id, scheme])

  useEffect(() => {
    const sent: number[] = []
    const onMessage = (event: MessageEvent) => {
      // The frame's origin is opaque, so identity is the sending window, never the origin.
      const target = frame.current?.contentWindow
      if (!target || event.source !== target) return
      const data: unknown = event.data
      if (!data || typeof data !== 'object' || (data as { type?: unknown }).type !== PANEL_ACTION_REQUEST_TYPE) return
      const { requestId, action, params } = data as { requestId?: unknown; action?: unknown; params?: unknown }
      if (typeof requestId !== 'string' || !requestId || requestId.length > 128) return
      const reply = (outcome: ActionOutcome) => target.postMessage({ type: PANEL_ACTION_RESULT_TYPE, requestId, ...outcome }, '*')
      const now = Date.now()
      while (sent.length && now - sent[0]! > PANEL_MESSAGE_RATE_LIMIT.perMs) sent.shift()
      if (sent.length >= PANEL_MESSAGE_RATE_LIMIT.maxMessages) return reply({ ok: false, errorCode: 'rate_limited', error: 'Too many requests' })
      sent.push(now)
      let size = 0
      try {
        size = JSON.stringify(data).length
      } catch {
        size = Infinity
      }
      if (size > PANEL_MESSAGE_MAX_BYTES) return reply({ ok: false, errorCode: 'invalid_request', error: 'Message too large' })
      if (typeof action !== 'string' || !(action in ACTION_CAPABILITY)) return reply({ ok: false, errorCode: 'unknown_method', error: `Unknown action ${String(action)}` })
      const plugin = enabledPlugins().find((p) => p.pluginKey === panel.pluginKey)
      const capability = ACTION_CAPABILITY[action]!
      if (!plugin?.manifest?.capabilities.some((c) => c.kind === capability)) {
        return reply({ ok: false, errorCode: 'capability_denied', error: `${panel.pluginName} did not declare ${capability}` })
      }
      void runAction(action, params, workspaceId, panel.pluginName).then(reply, (e: unknown) =>
        reply({ ok: false, errorCode: 'action_failed', error: e instanceof Error ? e.message : String(e) })
      )
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [panel.pluginKey, panel.pluginName, workspaceId])

  if (entry.status !== 'ready') {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center p-6 text-center text-sm text-muted-foreground">
        {entry.status === 'loading' ? t('Loading panel…') : entry.message}
      </div>
    )
  }
  return (
    <iframe
      ref={frame}
      title={`${panel.pluginName}: ${panel.title}`}
      // allow-scripts without allow-same-origin: an opaque origin with no app access.
      sandbox="allow-scripts"
      src={entry.src}
      className="min-h-0 w-full flex-1 border-0 bg-transparent"
      data-plugin-panel={panel.tab}
    />
  )
}
