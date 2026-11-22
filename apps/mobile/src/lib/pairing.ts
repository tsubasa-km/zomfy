// Pairing a phone with a host (docs/specs/mobile/pairing.md): read the offer from the QR code or
// link, make the phone's keys, build the pair request, and sign each connect's challenge.

import { ed25519, x25519 } from '@noble/curves/ed25519.js'
import {
  decodePairingOffer,
  deviceAuthPayload,
  fromBase64Url,
  toBase64Url,
  type PairRequest,
  type PairingOffer
} from '@zomfy/protocol'

/** Cryptographically secure random bytes (expo-crypto on the phone, Web Crypto in tests). */
export type RandomBytes = (length: number) => Uint8Array

/** The phone's keys for one host, base64url. The secret parts never leave the phone. */
export interface DeviceKeys {
  /** Ed25519 secret key (the 32-byte seed). */
  secretKey: string
  publicKey: string
  /** X25519 secret key, for the relay's end-to-end encryption (M2). */
  boxSecretKey: string
  boxPublicKey: string
}

export class OfferError extends Error {
  constructor(
    readonly reason: 'invalid' | 'expired',
    message: string
  ) {
    super(message)
    this.name = 'OfferError'
  }
}

/** Reads a pairing link or bare offer; throws OfferError when it is not one or its grant expired. */
export function readOffer(link: string, now: number = Date.now()): PairingOffer {
  let offer: PairingOffer
  try {
    offer = decodePairingOffer(link)
  } catch {
    throw new OfferError('invalid', 'Not a Zomfy pairing link')
  }
  if (isOfferExpired(offer, now)) throw new OfferError('expired', 'This pairing link has expired')
  if (offer.routes.length === 0) throw new OfferError('invalid', 'This pairing link has no route to the host')
  return offer
}

export const isOfferExpired = (offer: PairingOffer, now: number = Date.now()): boolean => now >= offer.expiresAt

export function generateDeviceKeys(randomBytes: RandomBytes): DeviceKeys {
  // Seeds come from the caller, so noble never needs crypto.getRandomValues (absent from Hermes).
  const secret = randomBytes(32)
  const boxSecret = randomBytes(32)
  return {
    secretKey: toBase64Url(secret),
    publicKey: toBase64Url(ed25519.getPublicKey(secret)),
    boxSecretKey: toBase64Url(boxSecret),
    boxPublicKey: toBase64Url(x25519.getPublicKey(boxSecret))
  }
}

export function buildPairRequest(offer: PairingOffer, keys: DeviceKeys, name: string, model: string | null): PairRequest {
  return {
    grant: offer.grant,
    name: name.trim() || 'Android phone',
    model,
    publicKey: keys.publicKey,
    boxPublicKey: keys.boxPublicKey
  }
}

/** base64url Ed25519 signature over the UTF-8 challenge payload. */
export function signChallenge(secretKey: string, hostId: string, deviceId: string, nonce: string): string {
  const message = new TextEncoder().encode(deviceAuthPayload(hostId, deviceId, nonce))
  return toBase64Url(ed25519.sign(message, fromBase64Url(secretKey)))
}
