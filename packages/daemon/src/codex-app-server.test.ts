import { expect, test } from 'bun:test'
import type * as acp from '@agentclientprotocol/sdk'
import { CodexAppServer } from './codex-app-server.ts'
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

async function opened(server: ReturnType<typeof wire>, updates: acp.SessionUpdate[] = [], mcpServers: acp.McpServer[] = []) {
  const codex = new CodexAppServer(server.input, server.output, async (update) => { updates.push(update) }, async () => ({ outcome: { outcome: 'cancelled' } }))
  const opening = codex.open('/work', null, mcpServers)
  await server.send({ id: (await server.next(method('initialize'))).id, result: {} })
  const start = await server.next(method('thread/start'))
  await server.send({ id: start.id, result: { thread: { id: 'thread' }, model: 'm' } })
  await server.send({ id: (await server.next(method('model/list'))).id, result: { data: [] } })
  await opening
  return { codex, start }
}

test('a turn/start the server rejects fails the turn but keeps the connection', async () => {
  const server = wire()
  const { codex } = await opened(server)
  const turn = codex.prompt([{ type: 'text', text: 'hi' }])
  const start = await server.next(method('turn/start'))
  await server.send({ id: start.id, error: { code: -32600, message: 'Model is not available' } })
  await expect(turn).rejects.toThrow('Model is not available')
  expect(codex.closed).toBe(false)
  codex.close()
})

test('a late event from the previous turn does not claim the new turn', async () => {
  const server = wire()
  const updates: acp.SessionUpdate[] = []
  const { codex } = await opened(server, updates)
  const turn = codex.prompt([{ type: 'text', text: 'hi' }])
  const start = await server.next(method('turn/start'))
  await server.send({ method: 'item/agentMessage/delta', params: { threadId: 'thread', turnId: 'old', itemId: 'a', delta: 'stale' } })
  await server.send({ method: 'turn/started', params: { threadId: 'thread', turn: { id: 'new', status: 'inProgress' } } })
  await server.send({ method: 'item/agentMessage/delta', params: { threadId: 'thread', turnId: 'new', itemId: 'b', delta: 'fresh' } })
  await server.send({ id: start.id, result: { turn: { id: 'new' } } })
  await server.send({ method: 'turn/completed', params: { threadId: 'thread', turn: { id: 'new', status: 'completed' } } })
  expect((await turn).stopReason).toBe('end_turn')
  const said = updates.flatMap((update) => update.sessionUpdate === 'agent_message_chunk' && update.content.type === 'text' ? [update.content.text] : [])
  expect(said).toEqual(['fresh'])
  codex.close()
})

test('an MCP server Codex cannot take is skipped with a notice', async () => {
  const server = wire()
  const updates: acp.SessionUpdate[] = []
  const { codex, start } = await opened(server, updates, [
    { type: 'sse', name: 'events', url: 'http://localhost/sse', headers: [] },
    { type: 'http', name: 'tools', url: 'http://localhost/mcp', headers: [] }
  ])
  expect(Object.keys((start.params as CodexFields).config as CodexFields)).toEqual(['mcp_servers.tools'])
  expect(updates.some((update) => update.sessionUpdate === 'notice' && update.title.includes('events'))).toBe(true)
  codex.close()
})
