import { describe, expect, test } from 'bun:test'
import { JsonRpcPeer, RPC_ERRORS, RpcError } from './json-rpc'

/** Two peers wired to each other. */
function pair() {
  const a: JsonRpcPeer = new JsonRpcPeer((text) => queueMicrotask(() => b.receive(text)))
  const b: JsonRpcPeer = new JsonRpcPeer((text) => queueMicrotask(() => a.receive(text)))
  return { a, b }
}

describe('JsonRpcPeer', () => {
  test('a request gets the handler result', async () => {
    const { a, b } = pair()
    b.onRequest('add', (params) => {
      const { x, y } = params as { x: number; y: number }
      return x + y
    })
    expect(await a.request<number>('add', { x: 2, y: 3 })).toBe(5)
  })

  test('requests carry distinct ids and answers match out of order', async () => {
    const sent: string[] = []
    const peer = new JsonRpcPeer((text) => sent.push(text))
    const first = peer.request('one')
    const second = peer.request('two')
    const [m1, m2] = sent.map((s) => JSON.parse(s))
    expect(m1.id).not.toBe(m2.id)
    expect(m1.jsonrpc).toBe('2.0')
    peer.receive(JSON.stringify({ jsonrpc: '2.0', id: m2.id, result: 'second' }))
    peer.receive(JSON.stringify({ jsonrpc: '2.0', id: m1.id, result: 'first' }))
    expect(await first).toBe('first')
    expect(await second).toBe('second')
  })

  test('an error answer rejects with its code', async () => {
    const { a, b } = pair()
    b.onRequest('boom', () => {
      throw new RpcError(-32001, 'Refused')
    })
    const error = (await a.request('boom').catch((e) => e)) as RpcError
    expect(error).toBeInstanceOf(RpcError)
    expect(error.code).toBe(-32001)
    expect(error.message).toBe('Refused')
  })

  test('an unknown method is answered with method not found', async () => {
    const { a } = pair()
    const error = (await a.request('nope').catch((e) => e)) as RpcError
    expect(error.code).toBe(RPC_ERRORS.methodNotFound)
  })

  test('notifications reach the handler and get no answer', async () => {
    const sent: string[] = []
    const peer = new JsonRpcPeer((text) => sent.push(text))
    const seen: [string, unknown][] = []
    peer.onNotification((method, params) => seen.push([method, params]))
    peer.receive(JSON.stringify({ jsonrpc: '2.0', method: 'session/update', params: { a: 1 } }))
    expect(seen).toEqual([['session/update', { a: 1 }]])
    peer.notify('session/cancel', { sessionId: 's' })
    expect(JSON.parse(sent[0]!)).toEqual({ jsonrpc: '2.0', method: 'session/cancel', params: { sessionId: 's' } })
  })

  test('an async incoming request is answered when it settles', async () => {
    const sent: string[] = []
    const peer = new JsonRpcPeer((text) => sent.push(text))
    let release: (v: unknown) => void = () => {}
    peer.onRequest('session/request_permission', () => new Promise((resolve) => (release = resolve)))
    peer.receive(JSON.stringify({ jsonrpc: '2.0', id: 'x1', method: 'session/request_permission', params: {} }))
    await Promise.resolve()
    expect(sent).toHaveLength(0)
    release({ outcome: { outcome: 'cancelled' } })
    await new Promise((r) => setTimeout(r, 0))
    expect(JSON.parse(sent[0]!)).toEqual({ jsonrpc: '2.0', id: 'x1', result: { outcome: { outcome: 'cancelled' } } })
  })

  test('close rejects pending requests and later ones', async () => {
    const peer = new JsonRpcPeer(() => {})
    const pending = peer.request('slow')
    peer.close()
    const error = (await pending.catch((e) => e)) as RpcError
    expect(error.code).toBe(RPC_ERRORS.closed)
    expect(peer.closed).toBe(true)
    await expect(peer.request('again')).rejects.toBeInstanceOf(RpcError)
  })

  test('a timeout rejects the request', async () => {
    const peer = new JsonRpcPeer(() => {})
    const error = (await peer.request('slow', undefined, { timeoutMs: 5 }).catch((e) => e)) as RpcError
    expect(error.code).toBe(RPC_ERRORS.timeout)
  })

  test('garbage frames are ignored', () => {
    const peer = new JsonRpcPeer(() => {})
    expect(() => peer.receive('not json')).not.toThrow()
    expect(() => peer.receive('null')).not.toThrow()
  })
})
