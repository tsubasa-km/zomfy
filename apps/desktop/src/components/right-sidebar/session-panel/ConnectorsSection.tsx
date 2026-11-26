import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2, LogIn, RefreshCw, RotateCw } from 'lucide-react'
import { HARNESS_METHODS, type ChatMcpServer, type ChatMcpServerStatus } from '@zomfy/protocol'
import { harnessRequest } from '@/daemon-connection'
import { openExternalUrl } from '@/lib/link-routing'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { Section } from './panel-parts'
import { ConnectorIcon } from './ConnectorIcon'
import { knownChatConnectors, noteChatConnectors } from '@/stores/composer-connectors-store'
import { CONNECTORS_READ_DELAY_MS, connectorsConnecting, connectorsReadNeeded, shownConnectors } from './connectors-read'
import { t } from '@/i18n/i18n'

// The chat's MCP servers (connectors) and their state, with sign-in for one that needs it and
// reconnect for one that failed. The daemon reads them from a Claude process of the chat's own, so
// the first read takes a few seconds; the list is read again while a server is connecting or a
// sign-in is waiting on the browser. A list read lately shows at once when the chat comes back to
// the front, and a chat only passed through on the way to another is not read (connectors-read.ts).

const POLL_MS = 3000
/** A sign-in is watched this long for the server to come up. */
const SIGN_IN_WATCH_MS = 3 * 60_000
/** Servers still connecting are watched this long. */
const PENDING_WATCH_MS = 60_000

const ORDER: Record<ChatMcpServerStatus, number> = { 'needs-auth': 0, failed: 1, pending: 2, connected: 3, disabled: 4 }
const DOT: Record<ChatMcpServerStatus, string> = {
  connected: 'bg-status-success',
  pending: 'bg-muted-foreground/60 animate-pulse',
  'needs-auth': 'bg-status-warning',
  failed: 'bg-destructive',
  disabled: 'bg-transparent border border-muted-foreground/60'
}

function statusLabel(status: ChatMcpServerStatus): string {
  switch (status) {
    case 'connected':
      return t('Connected')
    case 'pending':
      return t('Connecting…')
    case 'needs-auth':
      return t('Needs sign-in')
    case 'failed':
      return t('Failed')
    case 'disabled':
      return t('Disabled')
  }
}

interface SignIn {
  server: string
  /** Claude Code waits for the browser on localhost; its page can be pasted back if it cannot reach it. */
  callbackExpected: boolean
  startedAt: number
}

export function ConnectorsSection({ sessionId }: { sessionId: string }) {
  // The panel is keyed by the chat, so this runs once per chat brought to the front.
  const [servers, setServers] = useState<ChatMcpServer[] | null>(() => shownConnectors(knownChatConnectors(sessionId)))
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [signIn, setSignIn] = useState<SignIn | null>(null)
  const watchUntil = useRef(0)
  const current = useRef(sessionId)
  current.current = sessionId

  const read = useCallback(async () => {
    setLoading(true)
    try {
      const result = await harnessRequest(HARNESS_METHODS.chatMcpStatus, { sessionId })
      if (current.current !== sessionId) return
      setServers(result.servers)
      noteChatConnectors(sessionId, result.servers)
      setError(null)
      if (connectorsConnecting(result.servers)) watchUntil.current = Math.max(watchUntil.current, Date.now() + PENDING_WATCH_MS)
    } catch (e) {
      if (current.current === sessionId) setError(e instanceof Error ? e.message : String(e))
    } finally {
      if (current.current === sessionId) setLoading(false)
    }
  }, [sessionId])

  // Read once the chat has stayed in front a moment, unless what is known is recent and settled.
  useEffect(() => {
    if (!connectorsReadNeeded(knownChatConnectors(sessionId), Date.now())) return
    const timer = setTimeout(() => void read(), CONNECTORS_READ_DELAY_MS)
    return () => clearTimeout(timer)
  }, [read, sessionId])

  // Read again while something is changing: a server connecting, a sign-in in the browser.
  useEffect(() => {
    const timer = setInterval(() => {
      if (Date.now() < watchUntil.current && document.visibilityState === 'visible') void read()
    }, POLL_MS)
    return () => clearInterval(timer)
  }, [read])

  // A sign-in is over once its server is connected.
  useEffect(() => {
    if (signIn && servers?.find((s) => s.name === signIn.server)?.status === 'connected') setSignIn(null)
  }, [servers, signIn])

  const act = async (server: string, run: () => Promise<void>) => {
    setBusy(server)
    setError(null)
    try {
      await run()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  const reconnect = (server: string) =>
    act(server, async () => {
      const result = await harnessRequest(HARNESS_METHODS.chatMcpReconnect, { sessionId, server })
      setServers(result.servers)
      noteChatConnectors(sessionId, result.servers)
    })

  const startSignIn = (server: string) =>
    act(server, async () => {
      const start = await harnessRequest(HARNESS_METHODS.chatMcpAuthenticate, { sessionId, server })
      if (start.authUrl) openExternalUrl(start.authUrl)
      setSignIn({ server, callbackExpected: start.callbackExpected, startedAt: Date.now() })
      watchUntil.current = Date.now() + SIGN_IN_WATCH_MS
      if (!start.authUrl) await read()
    })

  const submitCallback = (server: string, callbackUrl: string) =>
    act(server, async () => {
      const result = await harnessRequest(HARNESS_METHODS.chatMcpCallback, { sessionId, server, callbackUrl })
      setServers(result.servers)
      noteChatConnectors(sessionId, result.servers)
    })

  const sorted = [...(servers ?? [])].sort((a, b) => ORDER[a.status] - ORDER[b.status] || a.name.localeCompare(b.name))
  const connected = sorted.filter((s) => s.status === 'connected').length
  return (
    <Section
      title={t('Connectors')}
      aside={
        <>
          {servers && servers.length > 0 && (
            <span className="text-[11px] text-muted-foreground tabular-nums">{t('{connected} of {total} connected', { connected, total: servers.length })}</span>
          )}
          <Button variant="ghost" size="icon" className="size-6" aria-label={t('Check the connectors again')} title={t('Check the connectors again')} disabled={loading} onClick={() => void read()}>
            <RefreshCw className={cn('size-3.5', loading && 'animate-spin')} />
          </Button>
        </>
      }
    >
      {error && <p className="break-words text-[11px] text-destructive">{error}</p>}
      {!servers && !error && (
        <p className="flex items-center gap-1.5 text-muted-foreground">
          <Loader2 className="size-3 animate-spin" />
          {t('Asking Claude Code for its MCP servers…')}
        </p>
      )}
      {servers && servers.length === 0 && <p className="text-muted-foreground">{t('No MCP servers are set up for this thread.')}</p>}
      {sorted.length > 0 && (
        <ul className="space-y-1" data-session-connectors>
          {sorted.map((server) => (
            <ConnectorRow
              key={server.name}
              server={server}
              busy={busy === server.name}
              signIn={signIn?.server === server.name ? signIn : null}
              onReconnect={() => void reconnect(server.name)}
              onSignIn={() => void startSignIn(server.name)}
              onCallback={(url) => void submitCallback(server.name, url)}
            />
          ))}
        </ul>
      )}
    </Section>
  )
}

function ConnectorRow({
  server,
  busy,
  signIn,
  onReconnect,
  onSignIn,
  onCallback
}: {
  server: ChatMcpServer
  busy: boolean
  signIn: SignIn | null
  onReconnect: () => void
  onSignIn: () => void
  onCallback: (url: string) => void
}) {
  const [pasted, setPasted] = useState('')
  const detail = [server.harness ? t('Built in') : server.scope, server.transport, server.status === 'connected' ? t('{n} tools', { n: server.tools.length }) : null]
    .filter((part): part is string => !!part)
    .join(' · ')
  return (
    <li className="space-y-1 rounded-md py-0.5" data-connector={server.name} data-connector-status={server.status}>
      <div className="flex items-center gap-2">
        <span className="relative shrink-0">
          <ConnectorIcon server={server} />
          <span
            className={cn('absolute -right-0.5 -bottom-0.5 size-2 rounded-full ring-2 ring-background', DOT[server.status])}
            title={statusLabel(server.status)}
            aria-hidden
          />
        </span>
        <div className="min-w-0 flex-1" title={server.url ?? server.name}>
          <div className="truncate">{server.name}</div>
          <div className="truncate text-[11px] text-muted-foreground">
            {statusLabel(server.status)}
            {detail ? ` · ${detail}` : ''}
          </div>
        </div>
        {!server.harness && server.status === 'needs-auth' && (
          <Button variant="outline" size="sm" className="h-6 gap-1 px-2 text-[11px]" disabled={busy} onClick={onSignIn}>
            {busy ? <Loader2 className="size-3 animate-spin" /> : <LogIn className="size-3" />}
            {t('Sign in')}
          </Button>
        )}
        {!server.harness && (server.status === 'failed' || (server.status === 'needs-auth' && signIn && !signIn.callbackExpected)) && (
          <Button variant="outline" size="sm" className="h-6 gap-1 px-2 text-[11px]" disabled={busy} onClick={onReconnect}>
            {busy ? <Loader2 className="size-3 animate-spin" /> : <RotateCw className="size-3" />}
            {t('Reconnect')}
          </Button>
        )}
      </div>
      {server.status === 'failed' && server.error && <p className="pl-7 text-[11px] break-words text-muted-foreground">{server.error}</p>}
      {signIn && (
        <div className="space-y-1 pl-7 text-[11px] text-muted-foreground" data-connector-sign-in>
          {signIn.callbackExpected ? (
            <>
              <p>{t('Finish signing in in the browser; this updates on its own.')}</p>
              <p>{t('If the browser ends on a page that does not load, paste that page’s address here:')}</p>
              <form
                className="flex gap-1"
                onSubmit={(event) => {
                  event.preventDefault()
                  if (pasted.trim()) onCallback(pasted.trim())
                }}
              >
                <Input value={pasted} onChange={(e) => setPasted(e.target.value)} placeholder="http://localhost:…/callback?code=…" className="h-6 text-[11px]" />
                <Button type="submit" variant="outline" size="sm" className="h-6 px-2 text-[11px]" disabled={busy || !pasted.trim()}>
                  {t('Send')}
                </Button>
              </form>
            </>
          ) : (
            <p>{t('Connect it on the claude.ai page that opened, then press Reconnect.')}</p>
          )}
        </div>
      )}
    </li>
  )
}
