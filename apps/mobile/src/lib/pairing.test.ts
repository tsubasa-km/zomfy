import { describe, expect, test } from 'bun:test'
import { ed25519, x25519 } from '@noble/curves/ed25519.js'
import { deviceAuthPayload, encodePairingOffer, fromBase64Url, type PairingOffer } from '@zomfy/protocol'
import { buildPairRequest, generateDeviceKeys, isOfferExpired, OfferError, readOffer, signChallenge } from './pairing'
import { testRandomBytes } from './testing'

const offer: PairingOffer = {
  v: 1,
  hostId: 'host-1',
  hostName: 'Desk',
  routes: [
    { kind: 'lan', url: 'http://192.168.1.20:7802' },
    { kind: 'tailnet', url: 'http://100.64.0.2:7802' }
  ],
  hostBoxPublicKey: 'AAAA',
  grant: 'grant-1',
  expiresAt: 1_000_000,
  scopes: ['chats:read', 'chats:operate']
}

function thrown(run: () => unknown): unknown {
  try {
    run()
  } catch (error) {
    return error
  }
  return undefined
}

describe('readOffer', () => {
  test('reads a zomfy://pair link and a bare offer', () => {
    const link = encodePairingOffer(offer)
    expect(readOffer(link, 0)).toEqual(offer)
    expect(readOffer(link.slice(link.indexOf('#') + 1), 0)).toEqual(offer)
    expect(readOffer(`  ${link}\n`, 0).hostId).toBe('host-1')
  })

  test('refuses an expired offer', () => {
    const error = thrown(() => readOffer(encodePairingOffer(offer), offer.expiresAt)) as OfferError
    expect(error).toBeInstanceOf(OfferError)
    expect(error.reason).toBe('expired')
    expect(isOfferExpired(offer, offer.expiresAt - 1)).toBe(false)
  })

  test('refuses anything that is not an offer', () => {
    for (const text of ['', 'https://example.com', 'zomfy://pair#bm9wZQ', 'zomfy://pair#']) {
      const error = thrown(() => readOffer(text, 0)) as OfferError
      expect(error).toBeInstanceOf(OfferError)
      expect(error.reason).toBe('invalid')
    }
  })

  test('refuses an offer without routes', () => {
    expect(() => readOffer(encodePairingOffer({ ...offer, routes: [] }), 0)).toThrow('no route')
  })
})

describe('keys and signing', () => {
  test('generated keys are 32-byte Ed25519 and X25519 pairs', () => {
    const keys = generateDeviceKeys(testRandomBytes)
    const secret = fromBase64Url(keys.secretKey)
    expect(secret).toHaveLength(32)
    expect(fromBase64Url(keys.publicKey)).toEqual(ed25519.getPublicKey(secret))
    expect(fromBase64Url(keys.boxPublicKey)).toEqual(x25519.getPublicKey(fromBase64Url(keys.boxSecretKey)))
  })

  test('the challenge signature verifies over the device auth payload', () => {
    const keys = generateDeviceKeys(testRandomBytes)
    const signature = signChallenge(keys.secretKey, 'host-1', 'device-1', 'nonce-1')
    const publicKey = fromBase64Url(keys.publicKey)
    const payload = new TextEncoder().encode(deviceAuthPayload('host-1', 'device-1', 'nonce-1'))
    expect(ed25519.verify(fromBase64Url(signature), payload, publicKey)).toBe(true)
    const other = new TextEncoder().encode(deviceAuthPayload('host-1', 'device-1', 'nonce-2'))
    expect(ed25519.verify(fromBase64Url(signature), other, publicKey)).toBe(false)
  })

  test('the pair request carries the grant and public keys only', () => {
    const keys = generateDeviceKeys(testRandomBytes)
    const request = buildPairRequest(offer, keys, '  Pixel  ', 'Pixel 9')
    expect(request).toEqual({
      grant: 'grant-1',
      name: 'Pixel',
      model: 'Pixel 9',
      publicKey: keys.publicKey,
      boxPublicKey: keys.boxPublicKey
    })
    expect(JSON.stringify(request)).not.toContain(keys.secretKey)
    expect(buildPairRequest(offer, keys, ' ', null).name).toBe('Android phone')
  })
})
