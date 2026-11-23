import { describe, expect, test } from 'bun:test'
import {
  deviceSigningText,
  hubToPhoneSocketSchema,
  limits,
  parseToHub,
  phoneSocketToHubSchema,
  relayDeviceId
} from './index'

const KEY = 'A'.repeat(43) + '='
const SIG = 'B'.repeat(86) + '=='

describe('the phone socket', () => {
  test('a phone signs its device id and the nonce under the relay domain', () => {
    expect(deviceSigningText('d_abcdefgh1234', 'bm9uY2U=')).toBe('zomfy-relay-v1|d_abcdefgh1234|bm9uY2U=')
  })

  test('auth, pair and frame parse toward the Hub', () => {
    for (const frame of [
      { type: 'auth', deviceId: 'd_abcdefgh1234', signature: SIG },
      { type: 'pair', deviceId: 'd_abcdefgh1234', publicKey: KEY, signature: SIG },
      { type: 'frame', data: 'Y2lwaGVy' }
    ]) {
      expect(phoneSocketToHubSchema.safeParse(frame).success).toBe(true)
    }
  })

  test('presence, auth-ok and errors parse toward the phone', () => {
    for (const frame of [
      { type: 'challenge', nonce: 'bm9uY2U=' },
      { type: 'auth-ok', deviceId: 'd_abcdefgh1234' },
      { type: 'host-offline' },
      { type: 'host-online' },
      { type: 'error', code: 'too_large' },
      { type: 'frame', data: '' }
    ]) {
      expect(hubToPhoneSocketSchema.safeParse(frame).success).toBe(true)
    }
  })

  test('a frame that is not base64 or over 1 MiB is refused', () => {
    expect(phoneSocketToHubSchema.safeParse({ type: 'frame', data: 'not base64!' }).success).toBe(false)
    expect(phoneSocketToHubSchema.safeParse({ type: 'frame', data: 'A'.repeat(limits.maxMessageBytes + 4) }).success).toBe(false)
  })

  test('a device id is d_ and 8 to 64 url-safe characters', () => {
    expect(relayDeviceId('0b6f7a52-3d0c-4a43-9a57-4f6f1b1c2d3e')).toMatch(/^d_[A-Za-z0-9_-]{8,64}$/)
    expect(phoneSocketToHubSchema.safeParse({ type: 'auth', deviceId: 'd_short', signature: SIG }).success).toBe(false)
  })

  test('device-sync is capped at the per-host device limit', () => {
    const devices = Array.from({ length: limits.maxDevicesPerHost + 1 }, (_, i) => ({ deviceId: `d_device${String(i).padStart(4, '0')}`, publicKey: KEY }))
    expect(parseToHub(JSON.stringify({ ch: 'phone', type: 'device-sync', devices })).kind).toBe('invalid')
    expect(parseToHub(JSON.stringify({ ch: 'phone', type: 'device-sync', devices: devices.slice(1) })).kind).toBe('message')
  })
})
