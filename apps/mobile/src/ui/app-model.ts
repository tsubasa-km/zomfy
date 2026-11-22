// The app's one model: the paired hosts (kept in secure storage), one HostConnection per host, the
// pending asks across them, and the prompts queued while a host is unreachable. Screens read it
// through the hooks in hooks.ts.

import type * as acp from '@agentclientprotocol/sdk'
import { promptNotSent } from '@zomfy/protocol'
import Constants from 'expo-constants'
import { getRandomBytes } from 'expo-crypto'
import { File, Paths } from 'expo-file-system'
import { addNetworkStateListener } from 'expo-network'
import * as SecureStore from 'expo-secure-store'
import { AppState, Platform } from 'react-native'
import { AskStore } from '../lib/asks'
import type { FetchLike, SocketLike } from '../lib/gateway-client'
import { HostConnection, NOT_CONNECTED, type PairedHost } from '../lib/host-connection'
import { loadHosts, removeHost, saveHost, type KeyValueStore } from '../lib/host-registry'
import { Observable } from '../lib/observable'
import { PromptQueue, type QueuedPrompt, type QueueStorage } from '../lib/prompt-queue'
import { installTextCodecs } from '../lib/utf8'

installTextCodecs()

export const APP_VERSION: string = Constants.expoConfig?.version ?? '0.1.0'

const webStore: KeyValueStore = {
  get: async (key) => globalThis.localStorage?.getItem(key) ?? null,
  set: async (key, value) => globalThis.localStorage?.setItem(key, value),
  delete: async (key) => globalThis.localStorage?.removeItem(key)
}

const secureStore: KeyValueStore = {
  get: (key) => SecureStore.getItemAsync(key),
  set: (key, value) => SecureStore.setItemAsync(key, value),
  delete: (key) => SecureStore.deleteItemAsync(key)
}

export const storage: KeyValueStore = Platform.OS === 'web' ? webStore : secureStore

export const randomBytes = (length: number): Uint8Array => getRandomBytes(length)

export const appFetch: FetchLike = (url, init) => fetch(url, init)

/** The queue and drafts are not secrets and may be long: a file, not secure storage. */
const queueStorage: QueueStorage =
  Platform.OS === 'web'
    ? { read: async () => globalThis.localStorage?.getItem('zomfy.queue') ?? null, write: async (text) => globalThis.localStorage?.setItem('zomfy.queue', text) }
    : {
        read: async () => {
          const file = new File(Paths.document, 'prompt-queue.json')
          return file.exists ? await file.text() : null
        },
        write: async (text) => {
          await new File(Paths.document, 'prompt-queue.json').write(text)
        }
      }

export const createSocket = (url: string): SocketLike => new WebSocket(url) as unknown as SocketLike

class AppModel {
  readonly hosts = new Observable<readonly PairedHost[]>([])
  readonly connections = new Observable<ReadonlyMap<string, HostConnection>>(new Map())
  readonly ready = new Observable(false)
  readonly asks = new AskStore()
  readonly queue = new PromptQueue(queueStorage)
  /** The start of the last queued prompt the host refused to send, for the chat to say so. */
  readonly notSent = new Observable<string | null>(null)
  private started = false
  private readonly watching = new Map<string, () => void>()

  async init(): Promise<void> {
    if (this.started) return
    this.started = true
    const hosts = await loadHosts(storage).catch(() => [])
    await this.queue.load()
    this.hosts.set(hosts)
    const map = new Map<string, HostConnection>()
    for (const host of hosts) map.set(host.hostId, this.open(host))
    this.connections.set(map)
    this.ready.set(true)
    // Back in front, or on another network: try every offline host at once rather than waiting out
    // the backoff, and check that a connected one's route still answers (T3 Code's wakeups).
    AppState.addEventListener('change', (state) => {
      if (state === 'active') for (const connection of this.connections.get().values()) connection.wake('foreground')
    })
    if (Platform.OS !== 'web') {
      addNetworkStateListener(() => {
        for (const connection of this.connections.get().values()) connection.wake('network')
      })
    }
  }

  connection(hostId: string): HostConnection | undefined {
    return this.connections.get().get(hostId)
  }

  /** Keeps a newly paired host (replacing an older pairing with it) and connects. */
  async addHost(host: PairedHost): Promise<void> {
    await saveHost(storage, host)
    this.connection(host.hostId)?.stop()
    this.asks.dropHost(host.hostId)
    this.hosts.update((list) => [...list.filter((h) => h.hostId !== host.hostId), host])
    const map = new Map(this.connections.get())
    map.set(host.hostId, this.open(host))
    this.connections.set(map)
  }

  /** Forgets the host and its keys on this phone. */
  async unpair(hostId: string): Promise<void> {
    this.connection(hostId)?.stop()
    this.watching.get(hostId)?.()
    this.watching.delete(hostId)
    this.asks.dropHost(hostId)
    await this.queue.dropHost(hostId)
    await removeHost(storage, hostId)
    this.hosts.update((list) => list.filter((h) => h.hostId !== hostId))
    const map = new Map(this.connections.get())
    map.delete(hostId)
    this.connections.set(map)
  }

  /** Sends a prompt now, or queues it while the host is unreachable. */
  async sendOrQueue(hostId: string, sessionId: string, text: string): Promise<'sent' | 'queued'> {
    const connection = this.connection(hostId)
    if (!connection || connection.state.get().status !== 'connected') {
      await this.queue.add(hostId, sessionId, text)
      return 'queued'
    }
    await this.queue.add(hostId, sessionId, text)
    void this.flush(hostId)
    return 'sent'
  }

  private async flush(hostId: string): Promise<void> {
    const connection = this.connection(hostId)
    if (!connection) return
    await this.queue.flush(hostId, async (prompt: QueuedPrompt) => {
      if (connection.state.get().status !== 'connected') return 'retry'
      try {
        const result = await connection.request<acp.PromptResponse>('session/prompt', {
          sessionId: prompt.sessionId,
          prompt: [{ type: 'text', text: prompt.text }]
        })
        // Refused by the host (it did not reach the agent): written again by hand, not retried in a loop.
        if (promptNotSent(result?._meta ?? null)) this.notSent.set(`${prompt.text.slice(0, 60)}`)
        return 'sent'
      } catch (error) {
        // Not connected when it was asked: it never left the phone. Lost mid-turn: it may have run.
        return error instanceof Error && error.message === NOT_CONNECTED ? 'retry' : 'sent'
      }
    })
  }

  private open(host: PairedHost): HostConnection {
    const connection = new HostConnection(host, {
      fetch: appFetch,
      createSocket,
      asks: this.asks,
      clientVersion: APP_VERSION,
      randomBytes
    })
    this.watching.get(host.hostId)?.()
    // Each connect sends what was queued while away, in order.
    let generation = -1
    this.watching.set(
      host.hostId,
      connection.state.subscribe(() => {
        const state = connection.state.get()
        if (state.status !== 'connected' || state.generation === generation) return
        generation = state.generation
        void this.flush(host.hostId)
      })
    )
    connection.start()
    return connection
  }
}

export const app = new AppModel()
