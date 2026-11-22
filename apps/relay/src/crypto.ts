import { base64ToBytes } from './contract'

const encoder = new TextEncoder()

export async function verifyEd25519(publicKey: string, signature: string, text: string): Promise<boolean> {
  try {
    const key = await crypto.subtle.importKey('raw', base64ToBytes(publicKey), { name: 'Ed25519' }, false, ['verify'])
    return await crypto.subtle.verify({ name: 'Ed25519' }, key, base64ToBytes(signature), encoder.encode(text))
  } catch {
    return false
  }
}

/** Whether a base64 string is a usable Ed25519 public key. */
export async function isEd25519PublicKey(publicKey: string): Promise<boolean> {
  try {
    await crypto.subtle.importKey('raw', base64ToBytes(publicKey), { name: 'Ed25519' }, false, ['verify'])
    return true
  } catch {
    return false
  }
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(text))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export function randomToken(bytes: number): string {
  const raw = crypto.getRandomValues(new Uint8Array(bytes))
  let text = ''
  for (const byte of raw) text += String.fromCharCode(byte)
  return btoa(text).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

/** Equal-length comparison that takes the same time wherever the strings differ. */
export function sameText(a: string, b: string): boolean {
  const x = encoder.encode(a)
  const y = encoder.encode(b)
  if (x.length !== y.length) return false
  return crypto.subtle.timingSafeEqual(x, y)
}
