// Registering this host with the person's Zomfy Relay (docs/specs/mobile/pairing.md): an Ed25519
// host key kept in `<home>/relay/host-key` (mode 0600), and `<home>/relay/relay.json` with the
// relay's URL and the host id it gave. Shared by bots and the phone relay.

import { createPrivateKey, createPublicKey, generateKeyPairSync, sign, type KeyObject } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { bytesToBase64, inviteSigningText, registerResponseSchema } from '@zomfy/relay-contract'

export interface HostKey {
  /** Raw 32-byte public key, base64, as the relay stores it. */
  publicKey: string
  sign(text: string): string
}

export interface RelayConfig {
  relayUrl: string
  hostId: string
  pairedAt: number
}

export function relayDir(home: string): string {
  return join(home, 'relay')
}

function hostKeyFrom(privateKey: KeyObject): HostKey {
  const spki = createPublicKey(privateKey).export({ format: 'der', type: 'spki' })
  return {
    publicKey: bytesToBase64(new Uint8Array(spki.subarray(spki.length - 32))),
    sign: (text) => bytesToBase64(new Uint8Array(sign(null, Buffer.from(text, 'utf8'), privateKey)))
  }
}

/** The host key, made on first use. The private part never leaves this file. */
export function loadOrCreateHostKey(home: string): HostKey {
  const dir = relayDir(home)
  const path = join(dir, 'host-key')
  if (existsSync(path)) return hostKeyFrom(createPrivateKey(readFileSync(path, 'utf8')))
  mkdirSync(dir, { recursive: true })
  const { privateKey } = generateKeyPairSync('ed25519')
  writeFileSync(path, privateKey.export({ format: 'pem', type: 'pkcs8' }), { mode: 0o600 })
  return hostKeyFrom(privateKey)
}

export function readRelayConfig(home: string): RelayConfig | null {
  try {
    const value = JSON.parse(readFileSync(join(relayDir(home), 'relay.json'), 'utf8')) as Partial<RelayConfig>
    if (typeof value.relayUrl !== 'string' || typeof value.hostId !== 'string') return null
    return { relayUrl: value.relayUrl, hostId: value.hostId, pairedAt: value.pairedAt ?? 0 }
  } catch {
    return null
  }
}

/** `https://x.workers.dev/` → `https://x.workers.dev`; only http(s) URLs are accepted. */
export function normalizeRelayUrl(text: string): string {
  const url = new URL(text.trim())
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('The relay URL must start with https://')
  return url.origin
}

export class RelayPairingError extends Error {
  constructor(
    readonly code: string,
    readonly status: number
  ) {
    super(
      code === 'bad_setup_code'
        ? 'The setup code is wrong.'
        : code === 'setup_code_used'
          ? 'This setup code was already used. Reset it with `wrangler secret put SETUP_CODE`, or ask a paired host for an invite.'
          : code === 'bad_invite'
            ? 'The invite is wrong, used or expired.'
            : `The relay refused the registration (${code}).`
    )
  }
}

export interface PairOptions {
  relayUrl: string
  setupCode?: string
  invite?: string
  hostName: string
  fetch?: typeof fetch
  now?: () => number
}

/**
 * Registers this host's key with the relay and saves the result. A host already paired with the
 * same relay keeps its id; pairing with another relay replaces the config (the key stays).
 */
export async function pairWithRelay(home: string, options: PairOptions): Promise<RelayConfig> {
  const relayUrl = normalizeRelayUrl(options.relayUrl)
  const key = loadOrCreateHostKey(home)
  const body = options.invite
    ? { invite: options.invite.trim(), publicKey: key.publicKey, name: options.hostName }
    : { setupCode: (options.setupCode ?? '').trim(), publicKey: key.publicKey, name: options.hostName }
  const res = await (options.fetch ?? fetch)(`${relayUrl}/v1/hosts/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
  const json = (await res.json().catch(() => ({}))) as { error?: string }
  if (!res.ok) throw new RelayPairingError(json.error ?? `http_${res.status}`, res.status)
  const { hostId } = registerResponseSchema.parse(json)
  const config: RelayConfig = { relayUrl, hostId, pairedAt: (options.now ?? Date.now)() }
  writeFileSync(join(relayDir(home), 'relay.json'), JSON.stringify(config, null, 2))
  return config
}

/** Forgets the relay and the host key; a later pairing makes a new key. */
export function unpairRelay(home: string): void {
  rmSync(join(relayDir(home), 'relay.json'), { force: true })
  rmSync(join(relayDir(home), 'host-key'), { force: true })
}

/** A signed invite request body, for `POST /v1/hosts/invite`. */
export function signedInviteRequest(home: string, hostId: string, at = Date.now()) {
  const key = loadOrCreateHostKey(home)
  return { hostId, at, signature: key.sign(inviteSigningText(hostId, at)) }
}
