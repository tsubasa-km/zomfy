// The paired hosts this phone keeps, and the pairing flow that adds one. Storage is passed in:
// expo-secure-store on the phone (localStorage on web), a Map in tests.

import type { PairingOffer } from '@zomfy/protocol'
import { GatewayError, pairWithHost, probeRoute, type FetchLike } from './gateway-client'
import type { PairedHost } from './host-connection'
import { buildPairRequest, generateDeviceKeys, type RandomBytes } from './pairing'
import { firstLiveRoute } from './routes'

export interface KeyValueStore {
  get(key: string): Promise<string | null>
  set(key: string, value: string): Promise<void>
  delete(key: string): Promise<void>
}

const INDEX_KEY = 'zomfy.hosts'
/** One entry per host: secure-store values are kept small, and keys allow only [A-Za-z0-9._-]. */
const hostKey = (hostId: string): string => `zomfy.host.${hostId.replace(/[^A-Za-z0-9._-]/g, '_')}`

async function readIndex(store: KeyValueStore): Promise<string[]> {
  try {
    const raw = await store.get(INDEX_KEY)
    const ids = raw ? (JSON.parse(raw) as unknown) : []
    return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : []
  } catch {
    return []
  }
}

export async function loadHosts(store: KeyValueStore): Promise<PairedHost[]> {
  const hosts: PairedHost[] = []
  for (const id of await readIndex(store)) {
    try {
      const raw = await store.get(hostKey(id))
      if (raw) hosts.push(JSON.parse(raw) as PairedHost)
    } catch {
      // An unreadable record is skipped; pairing again replaces it.
    }
  }
  return hosts
}

export async function saveHost(store: KeyValueStore, host: PairedHost): Promise<void> {
  await store.set(hostKey(host.hostId), JSON.stringify(host))
  const ids = await readIndex(store)
  if (!ids.includes(host.hostId)) await store.set(INDEX_KEY, JSON.stringify([...ids, host.hostId]))
}

/** Forgets the host and its keys on this phone. */
export async function removeHost(store: KeyValueStore, hostId: string): Promise<void> {
  await store.delete(hostKey(hostId))
  const ids = await readIndex(store)
  await store.set(INDEX_KEY, JSON.stringify(ids.filter((id) => id !== hostId)))
}

export interface PairOptions {
  offer: PairingOffer
  name: string
  model: string | null
  fetch: FetchLike
  randomBytes: RandomBytes
  now?: number
  probeTimeoutMs?: number
}

/** Presents the offer's grant on the first route that answers as the offer's host. */
export async function pairFromOffer(options: PairOptions): Promise<PairedHost> {
  const { offer } = options
  const index = await firstLiveRoute(offer.routes, async (route) => {
    const hello = await probeRoute(options.fetch, route.url, options.probeTimeoutMs ?? 3000)
    return hello.hostId === offer.hostId
  })
  if (index === null) throw new GatewayError('No route to the host answers')
  const keys = generateDeviceKeys(options.randomBytes)
  const route = offer.routes[index]!
  const response = await pairWithHost(options.fetch, route.url, buildPairRequest(offer, keys, options.name, options.model))
  if (response.hostId !== offer.hostId) throw new GatewayError('A different host answered on this route')
  return {
    hostId: response.hostId,
    hostName: response.hostName || offer.hostName,
    deviceId: response.deviceId,
    deviceName: options.name.trim(),
    scopes: response.scopes,
    routes: offer.routes,
    keys,
    pairedAt: options.now ?? Date.now()
  }
}
