import { expect, test } from 'bun:test'
import { CodexAppServerRpc, type CodexFields } from './codex-app-server-rpc.ts'

// An in-memory App Server: the test reads what the client writes and writes the server's frames.
function wire() {
  const toServer = new TransformStream<Uint8Array, Uint8Array>()
  const toClient = new TransformStream<Uint8Array, Uint8Array>()
  const writer = toClient.writable.getWriter()
  const encoder = new TextEncoder()
  const received: CodexFields[] = []
  const waiting: { match: (message: CodexFields) => boolean; resolve: (message: CodexFields) => void }[] = []
  void (async () => {
    const decoder = new TextDecoder()
    let buffer = ''
    for await (const bytes of toServer.readable) {
      buffer += decoder.decode(bytes, { stream: true })
      let end: number
      while ((end = buffer.indexOf('\n')) !== -1) {
        const message = JSON.parse(buffer.slice(0, end)) as CodexFields
        buffer = buffer.slice(end + 1)
        received.push(message)
        for (const wait of waiting.splice(0)) {
          if (wait.match(message)) wait.resolve(message)
          else waiting.push(wait)
        }
      }
    }
  })()
  return {
    input: toServer.writable,
    output: toClient.readable,
    received,
    raw: (line: string) => writer.write(encoder.encode(line + '\n')),
    send: (message: CodexFields) => writer.write(encoder.encode(JSON.stringify(message) + '\n')),
    end: () => writer.close(),
    next(match: (message: CodexFields) => boolean): Promise<CodexFields> {
      const found = received.find(match)
      if (found) return Promise.resolve(found)
      return new Promise((resolve) => waiting.push({ match, resolve }))
    }
  }
}

const method = (name: string) => (message: CodexFields) => message.method === name

test('a stdout line that is not JSON is skipped and the connection keeps working', async () => {
  const server = wire()
  const closed: Error[] = []
  const rpc = new CodexAppServerRpc(server.input, server.output, async () => undefined, async () => ({}), (error) => closed.push(error))
  const answer = rpc.request('ping', {})
  const sent = await server.next(method('ping'))
  await server.raw('WARNING: proceeding, even though we could not update PATH')
  await server.send({ id: sent.id, result: { ok: true } })
  expect(await answer).toEqual({ ok: true })
  expect(rpc.closed).toBe(false)
  expect(closed).toEqual([])
  rpc.close()
})

test('a server request waits for the notifications sent before it', async () => {
  const server = wire()
  const order: string[] = []
  let release!: () => void
  const slow = new Promise<void>((resolve) => (release = resolve))
  const rpc = new CodexAppServerRpc(server.input, server.output, async (name) => {
    if (name === 'item/started') await slow
    order.push(name)
  }, async (name) => {
    order.push(name)
    return {}
  }, () => undefined)
  await server.send({ method: 'item/started', params: {} })
  await server.send({ id: 'ask', method: 'item/commandExecution/requestApproval', params: {} })
  await Bun.sleep(30)
  expect(order).toEqual([])
  release()
  await server.next((message) => message.id === 'ask')
  expect(order).toEqual(['item/started', 'item/commandExecution/requestApproval'])
  rpc.close()
})

test('a server request that waits for the person does not hold back later notifications', async () => {
  const server = wire()
  const order: string[] = []
  const rpc = new CodexAppServerRpc(server.input, server.output, async (name) => {
    order.push(name)
  }, () => new Promise(() => undefined), () => undefined)
  await server.send({ id: 'ask', method: 'item/commandExecution/requestApproval', params: {} })
  await server.send({ method: 'turn/completed', params: {} })
  await Bun.sleep(30)
  expect(order).toEqual(['turn/completed'])
  rpc.close()
})
