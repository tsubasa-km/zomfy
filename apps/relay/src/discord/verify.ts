// Discord signs every HTTP interaction: Ed25519 over `X-Signature-Timestamp + raw body`, with the
// application's public key, all hex (docs/specs/bots/sources/discord.md#signatures-and-limits).

import { limits } from '../contract'

const encoder = new TextEncoder()

function hexToBytes(hex: string): Uint8Array | null {
  if (!/^(?:[0-9a-f]{2})+$/i.test(hex)) return null
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return out
}

export async function verifyDiscordRequest(publicKeyHex: string, signatureHex: string, timestamp: string, body: string): Promise<boolean> {
  const key = hexToBytes(publicKeyHex)
  const signature = hexToBytes(signatureHex)
  if (!key || key.length !== 32 || !signature || signature.length !== 64 || !/^\d+$/.test(timestamp)) return false
  // An old signed request replayed later is refused.
  if (Math.abs(Date.now() - Number(timestamp) * 1000) > limits.signedRequestSkewMs) return false
  try {
    const cryptoKey = await crypto.subtle.importKey('raw', key, { name: 'Ed25519' }, false, ['verify'])
    return await crypto.subtle.verify({ name: 'Ed25519' }, cryptoKey, signature, encoder.encode(timestamp + body))
  } catch {
    return false
  }
}
