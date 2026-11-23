import { useEffect, useState } from 'react'
import { Copy, Smartphone, Trash2, QrCode, X } from 'lucide-react'
import type { PairingOffer, RemoteDevice, RemoteRoute } from '@zomfy/protocol'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { qrPath } from '@/lib/qr-path'
import {
  createPairingOffer,
  refreshDevices,
  revokeDevice,
  setListenerEnabled,
  useDevicesSnapshot
} from '@/stores/devices-store'
import { SettingsRow, SettingsSubsectionHeader, SettingsSwitchRow } from './settings-form-controls'
import { t } from '@/i18n/i18n'

// Settings → Devices (docs/specs/mobile/pairing.md): the phone listener, a one-time pairing QR code
// and link, and the paired phones with the route each uses, and Revoke. Phones pair with this
// computer's daemon, directly or through Zomfy Relay (docs/specs/mobile/relay.md).

const SCOPE_LABELS: Record<string, string> = {
  'chats:read': 'Read chats',
  'chats:operate': 'Prompt, stop and approve',
  'terminals:operate': 'Terminals',
  'workspaces:operate': 'Workspaces',
  'bots:read': 'Bots'
}

function QrCodeView({ text }: { text: string }) {
  const { size, path } = qrPath(text)
  const margin = 4
  return (
    <svg
      viewBox={`${-margin} ${-margin} ${size + margin * 2} ${size + margin * 2}`}
      className="size-72 shrink-0 rounded-md bg-white"
      shapeRendering="crispEdges"
      role="img"
      aria-label={t('Pairing QR code')}
      data-pairing-qr
    >
      <path d={path} fill="#000" />
    </svg>
  )
}

function routeName(kind: RemoteRoute['kind']): string {
  return kind === 'relay' ? t('Zomfy Relay') : kind === 'tailnet' ? t('Tailnet') : t('Wi-Fi / LAN')
}

function minutesLeft(expiresAt: number, now: number): number {
  return Math.max(0, Math.ceil((expiresAt - now) / 60_000))
}

function PairingCard({ offer, link, onClose }: { offer: PairingOffer; link: string; onClose: () => void }) {
  const [now, setNow] = useState(Date.now())
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 5_000)
    return () => clearInterval(timer)
  }, [])
  const left = minutesLeft(offer.expiresAt, now)
  return (
    <div className="flex gap-5 rounded-lg border border-border/60 bg-background/40 p-4" data-pairing-card>
      <QrCodeView text={link} />
      <div className="min-w-0 flex-1 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div className="space-y-1">
            <p className="text-sm font-medium">{t('Scan this with the Zomfy app')}</p>
            <p className="text-xs text-muted-foreground">
              {left === 0
                ? t('This code expired. Make a new one.')
                : offer.routes.some((r) => r.kind === 'relay')
                  ? t('Works once, for {n} more minutes.', { n: String(left) })
                  : t('Works once, for {n} more minutes. The phone must be on the same network or tailnet.', { n: String(left) })}
            </p>
          </div>
          <Button variant="ghost" size="icon-xs" aria-label={t('Close')} onClick={onClose}>
            <X />
          </Button>
        </div>
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">{t('Or paste this link in the app:')}</p>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded bg-muted px-2 py-1 text-xs select-all" data-pairing-link>
              {link}
            </code>
            <Button
              variant="outline"
              size="xs"
              onClick={() => {
                void navigator.clipboard.writeText(link).then(() => setCopied(true))
              }}
            >
              <Copy />
              {copied ? t('Copied') : t('Copy')}
            </Button>
          </div>
        </div>
        <div className="space-y-1 text-xs text-muted-foreground">
          <p>{t('Reachable at:')}</p>
          <ul className="list-inside list-disc">
            {offer.routes.map((r) => (
              <li key={r.url}>
                {routeName(r.kind)}: <code>{r.url}</code>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  )
}

function DeviceRow({ device }: { device: RemoteDevice }) {
  const [busy, setBusy] = useState(false)
  const seen = device.connected
    ? device.route
      ? t('Connected now through {route}', { route: routeName(device.route) })
      : t('Connected now')
    : device.lastSeenAt
      ? t('Last seen {time}', { time: new Date(device.lastSeenAt).toLocaleString() })
      : t('Not connected yet')
  return (
    <div className="flex items-center gap-3 py-3" data-device-row={device.id}>
      <Smartphone className="size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="flex items-center gap-2 text-sm">
          <span className={cn('inline-block size-2 rounded-full', device.connected ? 'bg-status-success' : 'bg-muted-foreground')} />
          {device.name}
          {device.model ? <span className="text-xs text-muted-foreground">{device.model}</span> : null}
        </p>
        <p className="text-xs text-muted-foreground">
          {t('Paired {date}', { date: new Date(device.createdAt).toLocaleDateString() })} · {seen}
        </p>
        <p className="text-xs text-muted-foreground">{device.scopes.map((s) => t(SCOPE_LABELS[s] ?? s)).join(', ')}</p>
      </div>
      <Button
        variant="outline"
        size="xs"
        disabled={busy}
        onClick={() => {
          setBusy(true)
          void revokeDevice(device.id).finally(() => setBusy(false))
        }}
      >
        <Trash2 />
        {t('Revoke')}
      </Button>
    </div>
  )
}

export function DevicesPane() {
  const snapshot = useDevicesSnapshot()
  const [pairing, setPairing] = useState<{ offer: PairingOffer; link: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    void refreshDevices().catch((e) => setError(e instanceof Error ? e.message : String(e)))
  }, [])
  // A new phone that just paired with the code on screen closes it.
  const deviceCount = snapshot?.devices.length ?? 0
  const [countAtOffer, setCountAtOffer] = useState(0)
  useEffect(() => {
    if (pairing && deviceCount > countAtOffer) setPairing(null)
  }, [pairing, deviceCount, countAtOffer])

  const listener = snapshot?.listener
  const relay = snapshot?.relay ?? null
  const canPair = Boolean(listener?.running || relay)
  const run = (task: Promise<unknown>) => {
    setError(null)
    void task.catch((e) => setError(e instanceof Error ? e.message : String(e)))
  }
  return (
    <div className="space-y-4">
      <div className="divide-y divide-border/40">
        <SettingsSwitchRow
          label={t('Let phones connect')}
          description={
            listener?.running
              ? t('Listening on port {port} for phones on this network or tailnet. Other addresses are refused.', { port: String(listener.port) })
              : t('Opens port {port} to private and tailnet addresses only, so a paired phone can reach this computer.', {
                  port: String(listener?.port ?? 7802)
                })
          }
          keywords={['phone', 'android', 'mobile', 'lan', 'tailscale', 'listener', 'port']}
          checked={listener?.enabled ?? false}
          disabled={!snapshot}
          onChange={(checked) => run(setListenerEnabled(checked))}
        />
        {listener?.error ? (
          <p className="py-2 text-xs text-destructive">{t('Could not listen: {reason}', { reason: listener.error })}</p>
        ) : null}
        <SettingsRow
          label={t('Pair a phone')}
          description={
            listener?.running
              ? t('Shows a QR code for the Zomfy app on your Android phone.')
              : relay
                ? t('Shows a QR code for the Zomfy app on your Android phone. Without the listener the phone pairs through Zomfy Relay.')
                : t('Turn on “Let phones connect”, or pair Zomfy Relay in Settings → Bots, first.')
          }
          keywords={['pair', 'qr', 'phone', 'android', 'link']}
          control={
            <Button
              variant="outline"
              size="sm"
              disabled={!canPair}
              onClick={() =>
                run(
                  createPairingOffer().then((next) => {
                    setCountAtOffer(deviceCount)
                    setPairing(next)
                  })
                )
              }
            >
              <QrCode />
              {pairing ? t('New code') : t('Pair a phone')}
            </Button>
          }
        />
      </div>
      {relay ? (
        <p className="text-xs text-muted-foreground" data-relay-route={relay.online ? 'online' : 'offline'}>
          {relay.online
            ? t('Phones can also reach this computer from anywhere through Zomfy Relay, end-to-end encrypted.')
            : t('Zomfy Relay is paired but not connected right now; phones use it once it is back.')}
        </p>
      ) : null}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      {pairing ? <PairingCard offer={pairing.offer} link={pairing.link} onClose={() => setPairing(null)} /> : null}
      <div className="space-y-1 rounded-lg border border-border/60 bg-background/40 px-4 py-3" data-paired-devices>
        <SettingsSubsectionHeader
          title={t('Paired phones')}
          description={t('A phone stays paired until you revoke it. Revoking closes its connection at once.')}
        />
        {snapshot && snapshot.devices.length === 0 ? <p className="py-2 text-sm text-muted-foreground">{t('No phones yet.')}</p> : null}
        <div className="divide-y divide-border/40">
          {snapshot?.devices.map((d) => (
            <DeviceRow key={d.id} device={d} />
          ))}
        </div>
      </div>
    </div>
  )
}
