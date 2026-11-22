import { describe, expect, test } from 'bun:test'
import { ed25519 } from '@noble/curves/ed25519.js'
import { deviceAuthPayload, fromBase64Url, GATEWAY_CLOSE } from '@zomfy/protocol'
import { connectDevice, deviceSocketUrl, GatewayError, pairWithHost, probeRoute, type SocketLike } from './gateway-client'
import { buildPairRequest, generateDeviceKeys } from './pairing'
import { FakeGateway, flush, testRandomBytes } from './testing'

const LAN = 'http://192.168.1.20:7802'

function gateway(): FakeGateway {
  const g = new FakeGateway('host-1', 'Desk')
  g.live.add(LAN)
  g.grants.add('grant-1')
  return g
}

async function paired(g: FakeGateway) {
  const keys = generateDeviceKeys(testRandomBytes)
  const offer = { grant: 'grant-1' } as Parameters<typeof buildPairRequest>[0]
  const response = await pairWithHost(g.fetch, LAN, buildPairRequest(offer, keys, 'Pixel', 'Pixel 9'))
  return { keys, response }
}

describe('gateway client', () => {
  test('the device socket URL follows the route scheme', () => {
    expect(deviceSocketUrl('http://10.0.0.2:7802/')).toBe('ws://10.0.0.2:7802/v1/device')
    expect(deviceSocketUrl('https://desk.tail.ts.net')).toBe('wss://desk.tail.ts.net/v1/device')
  })

  test('probe answers with the host, and fails for a dead route', async () => {
    const g = gateway()
    expect(await probeRoute(g.fetch, LAN)).toEqual({ hostId: 'host-1', hostName: 'Desk' })
    await expect(probeRoute(g.fetch, 'http://10.9.9.9:7802')).rejects.toBeInstanceOf(GatewayError)
  })

  test('pairing burns the grant; a second use shows the host error', async () => {
    const g = gateway()
    const { response } = await paired(g)
    expect(response.hostId).toBe('host-1')
    expect(response.scopes).toEqual(['chats:read', 'chats:operate'])
    const again = pairWithHost(g.fetch, LAN, buildPairRequest({ grant: 'grant-1' } as never, generateDeviceKeys(testRandomBytes), 'x', null))
    const error = (await again.catch((e) => e)) as GatewayError
    expect(error.message).toBe('This pairing link was already used or expired')
    expect(error.code).toBe(403)
  })

  test('connect answers the challenge with a signature the host verifies', async () => {
    const g = gateway()
    const { keys, response } = await paired(g)
    let sentAuth: { deviceId: string; signature: string } | null = null
    const spy = (url: string): SocketLike => {
      const socket = g.createSocket(url)
      const send = socket.send.bind(socket)
      socket.send = (data: string) => {
        const frame = JSON.parse(data)
        if (frame.type === 'auth') sentAuth = frame
        send(data)
      }
      return socket
    }
    const socket = await connectDevice(spy, LAN, { hostId: 'host-1', deviceId: response.deviceId, secretKey: keys.secretKey })
    expect(socket.scopes).toEqual(['chats:read', 'chats:operate'])
    expect(sentAuth).not.toBeNull()
    const nonceSocket = g.sockets[0]!
    expect(nonceSocket.authed).toBe(true)
    // Verify independently with noble: the signature covers the exact payload string.
    const auth = sentAuth as unknown as { deviceId: string; signature: string }
    const nonce = (nonceSocket as unknown as { nonce: string }).nonce
    const payload = new TextEncoder().encode(deviceAuthPayload('host-1', auth.deviceId, nonce))
    expect(ed25519.verify(fromBase64Url(auth.signature), payload, fromBase64Url(keys.publicKey))).toBe(true)

    // After ready, frames are passed through.
    const seen: string[] = []
    socket.onMessage = (text) => seen.push(text)
    g.notify('session/update', { x: 1 })
    await flush()
    expect(JSON.parse(seen[0]!)).toEqual({ jsonrpc: '2.0', method: 'session/update', params: { x: 1 } })
  })

  test('an unknown device is refused with 4401 and reads as unpaired', async () => {
    const g = gateway()
    const keys = generateDeviceKeys(testRandomBytes)
    const error = (await connectDevice(g.createSocket, LAN, { hostId: 'host-1', deviceId: 'nobody', secretKey: keys.secretKey }).catch(
      (e) => e
    )) as GatewayError
    expect(error.code).toBe(GATEWAY_CLOSE.unauthorized)
    expect(error.unpaired).toBe(true)
    expect(error.message).toBe('This phone was unpaired; pair again')
  })

  test('a different host on the route is refused', async () => {
    const g = gateway()
    const { keys, response } = await paired(g)
    const error = (await connectDevice(g.createSocket, LAN, { hostId: 'other-host', deviceId: response.deviceId, secretKey: keys.secretKey }).catch(
      (e) => e
    )) as GatewayError
    expect(error.message).toBe('A different host answered on this route')
    expect(error.unpaired).toBe(false)
  })

  test('a revoke while connected reaches onClose as unpaired', async () => {
    const g = gateway()
    const { keys, response } = await paired(g)
    const socket = await connectDevice(g.createSocket, LAN, { hostId: 'host-1', deviceId: response.deviceId, secretKey: keys.secretKey })
    let closed: GatewayError | null = null
    socket.onClose = (error) => (closed = error)
    g.openSocket!.close(GATEWAY_CLOSE.revoked)
    await flush()
    expect((closed as GatewayError | null)?.unpaired).toBe(true)
  })
})
