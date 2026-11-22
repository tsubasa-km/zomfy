import { expect, test } from 'bun:test'
import { encodePairingOffer, type PairingOffer } from '@zomfy/protocol'
import { qrPath } from '../src/lib/qr-path.ts'

// The pairing QR code holds the whole `zomfy://pair#…` link; it must stay scannable on a phone.

const offer: PairingOffer = {
  v: 1,
  hostId: crypto.randomUUID(),
  hostName: 'DESKTOP-ABC123',
  routes: [
    { kind: 'lan', url: 'http://192.168.1.20:7802' },
    { kind: 'tailnet', url: 'http://100.90.1.2:7802' }
  ],
  hostBoxPublicKey: 'A'.repeat(43),
  grant: 'B'.repeat(43),
  expiresAt: Date.now() + 600_000,
  scopes: ['chats:read', 'chats:operate', 'terminals:operate', 'workspaces:operate', 'bots:read']
}

test('a pairing link becomes a QR path of unit squares', () => {
  const { size, path } = qrPath(encodePairingOffer(offer))
  // Version 17 or below (85 modules), at low error correction, keeps the modules large enough for a phone camera.
  expect(size).toBeLessThanOrEqual(85)
  expect(path).toMatch(/^(M\d+ \d+h1v1h-1z)+$/)
})
