import { describe, expect, test } from 'bun:test'
import type { RemoteRoute } from '@zomfy/protocol'
import { PromptQueue, type QueueStorage, type QueuedPrompt } from './prompt-queue'
import { RouteChooser } from './routes'
import { FakeTimers, flush } from './testing'

function memory(): QueueStorage & { text: string | null } {
  const store = {
    text: null as string | null,
    read: async () => store.text,
    write: async (text: string) => {
      store.text = text
    }
  }
  return store
}

describe('offline prompt queue', () => {
  test('sends in order, once, and only the host it was written for', async () => {
    const queue = new PromptQueue(memory())
    await queue.add('h1', 's1', 'first')
    await queue.add('h2', 's9', 'other host')
    await queue.add('h1', 's2', 'second')
    const sent: string[] = []
    const send = async (p: QueuedPrompt) => {
      sent.push(p.text)
      return 'sent' as const
    }
    expect(await queue.flush('h1', send)).toBe(2)
    expect(await queue.flush('h1', send)).toBe(0)
    expect(sent).toEqual(['first', 'second'])
    expect(queue.list('h2').map((p) => p.text)).toEqual(['other host'])
  })

  test('survives a reload, drafts included', async () => {
    const storage = memory()
    const before = new PromptQueue(storage)
    await before.add('h1', 's1', 'written in a tunnel')
    await before.setDraft('h1', 's1', 'half a thought')
    const after = new PromptQueue(storage)
    await after.load()
    expect(after.list('h1', 's1').map((p) => p.text)).toEqual(['written in a tunnel'])
    expect(after.draft('h1', 's1')).toBe('half a thought')
    await after.setDraft('h1', 's1', '')
    const again = new PromptQueue(storage)
    await again.load()
    expect(again.draft('h1', 's1')).toBe('')
  })

  test('a removed chip is not sent', async () => {
    const queue = new PromptQueue(memory())
    const a = await queue.add('h1', 's1', 'keep')
    const b = await queue.add('h1', 's1', 'take back')
    await queue.remove(b.id)
    const sent: string[] = []
    await queue.flush('h1', async (p) => (sent.push(p.text), 'sent'))
    expect(sent).toEqual(['keep'])
    expect(queue.list('h1')).toEqual([])
    expect(a.id).not.toBe(b.id)
  })

  test('a prompt that never left goes back first in line, and the run stops', async () => {
    const queue = new PromptQueue(memory())
    await queue.add('h1', 's1', 'one')
    await queue.add('h1', 's1', 'two')
    const tried: string[] = []
    expect(await queue.flush('h1', async (p) => (tried.push(p.text), 'retry'))).toBe(0)
    expect(tried).toEqual(['one'])
    expect(queue.list('h1').map((p) => p.text)).toEqual(['one', 'two'])
  })

  test('a send that fails mid-turn is not sent again (at most once)', async () => {
    const queue = new PromptQueue(memory())
    await queue.add('h1', 's1', 'maybe ran')
    await queue.flush('h1', async () => {
      throw new Error('connection lost')
    })
    expect(queue.list('h1')).toEqual([])
  })

  test('two flushes at once send each prompt once', async () => {
    const queue = new PromptQueue(memory())
    await queue.add('h1', 's1', 'a')
    await queue.add('h1', 's1', 'b')
    const sent: string[] = []
    const slow = async (p: QueuedPrompt) => {
      sent.push(p.text)
      await flush()
      return 'sent' as const
    }
    await Promise.all([queue.flush('h1', slow), queue.flush('h1', slow)])
    expect(sent).toEqual(['a', 'b'])
  })

  test('a damaged file starts empty', async () => {
    const storage = memory()
    storage.text = '{not json'
    const queue = new PromptQueue(storage)
    await queue.load()
    expect(queue.state.get().queue).toEqual([])
  })
})

describe('route chooser wakeups', () => {
  const routes: RemoteRoute[] = [
    { kind: 'lan', url: 'http://192.168.1.20:7802' },
    { kind: 'tailnet', url: 'http://100.64.0.2:7802' },
    { kind: 'relay', url: 'https://relay.example.com', relayHostId: 'h_relayhost01' }
  ]

  test('on the relay, probeNow looks for a better route at once instead of at the next timer', async () => {
    const timers = new FakeTimers()
    const live = new Set(['relay'])
    const recovered: number[] = []
    const chooser = new RouteChooser({ routes, probe: async (r) => live.has(r.kind), timers, random: () => 0, onPreferredRecovered: (i) => recovered.push(i) })
    expect(await chooser.pick()).toBe(2)
    chooser.use(2)
    live.add('tailnet')
    chooser.probeNow()
    await flush()
    expect(recovered).toEqual([1])
    chooser.stop()
  })

  test('falls back LAN → tailnet → relay, in that order', async () => {
    const calls: string[] = []
    const chooser = new RouteChooser({
      routes,
      probe: async (r) => (calls.push(r.kind), r.kind === 'relay'),
      timers: new FakeTimers(),
      onPreferredRecovered: () => {}
    })
    expect(await chooser.pick()).toBe(2)
    expect(calls).toEqual(['lan', 'tailnet', 'relay'])
  })
})
