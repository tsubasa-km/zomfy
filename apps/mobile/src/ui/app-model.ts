// The app's one model: the paired hosts (kept in secure storage), one HostConnection per host, and
// the pending asks across them. Screens read it through the hooks in hooks.ts.

import Constants from 'expo-constants'
import { getRandomBytes } from 'expo-crypto'
import * as SecureStore from 'expo-secure-store'
import { AppState, Platform } from 'react-native'
import { AskStore } from '../lib/asks'
import type { FetchLike, SocketLike } from '../lib/gateway-client'
import { HostConnection, type PairedHost } from '../lib/host-connection'
import { loadHosts, removeHost, saveHost, type KeyValueStore } from '../lib/host-registry'
import { Observable } from '../lib/observable'
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

const createSocket = (url: string): SocketLike => new WebSocket(url) as unknown as SocketLike

class AppModel {
  readonly hosts = new Observable<readonly PairedHost[]>([])
  readonly connections = new Observable<ReadonlyMap<string, HostConnection>>(new Map())
  readonly ready = new Observable(false)
  readonly asks = new AskStore()
  private started = false

  async init(): Promise<void> {
    if (this.started) return
    this.started = true
    const hosts = await loadHosts(storage).catch(() => [])
    this.hosts.set(hosts)
    const map = new Map<string, HostConnection>()
    for (const host of hosts) map.set(host.hostId, this.open(host))
    this.connections.set(map)
    this.ready.set(true)
    // Back in front: try every offline host again at once rather than waiting out the backoff.
    AppState.addEventListener('change', (state) => {
      if (state === 'active') for (const connection of this.connections.get().values()) connection.retryNow()
    })
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
    this.asks.dropHost(hostId)
    await removeHost(storage, hostId)
    this.hosts.update((list) => list.filter((h) => h.hostId !== hostId))
    const map = new Map(this.connections.get())
    map.delete(hostId)
    this.connections.set(map)
  }

  private open(host: PairedHost): HostConnection {
    const connection = new HostConnection(host, {
      fetch: appFetch,
      createSocket,
      asks: this.asks,
      clientVersion: APP_VERSION
    })
    connection.start()
    return connection
  }
}

export const app = new AppModel()
