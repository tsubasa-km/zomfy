// Native signature checks for the senders Orca supports (docs/specs/bots/sources/webhooks.md):
// Standard Webhooks, GitHub, Sentry, Linear, PagerDuty and Stripe. Each takes the hook's secret, the
// call's lower-cased headers and its raw body.

import type { WebhookAdapterId } from '../contract'
import { limits } from '../contract'
import { hmacBase64, hmacHex, sameDigest } from '../sources/common'

/** Headers that carry a signature, dropped from the stored call. */
export const SIGNATURE_HEADERS = ['webhook-signature', 'x-hub-signature', 'x-hub-signature-256', 'sentry-hook-signature', 'linear-signature', 'x-pagerduty-signature', 'stripe-signature']

const LINEAR_SKEW_MS = 60 * 1000

function withinSkew(seconds: number, skewMs = limits.signedRequestSkewMs) {
  return Number.isFinite(seconds) && Math.abs(Date.now() - seconds * 1000) <= skewMs
}

export async function verifySender(adapter: WebhookAdapterId, secret: string, headers: Record<string, string>, body: string): Promise<boolean> {
  switch (adapter) {
    case 'standard': {
      const id = headers['webhook-id']
      const timestamp = headers['webhook-timestamp']
      const signatures = headers['webhook-signature']
      if (!id || !timestamp || !signatures || !withinSkew(Number(timestamp))) return false
      let key: Uint8Array
      try {
        key = secret.startsWith('whsec_') ? Uint8Array.from(atob(secret.slice(6)), (c) => c.charCodeAt(0)) : new TextEncoder().encode(secret)
      } catch {
        return false
      }
      const expected = await hmacBase64(key, `${id}.${timestamp}.${body}`)
      return signatures.split(' ').some((part) => {
        const [version, sig] = part.split(',')
        return version === 'v1' && sig !== undefined && sameDigest(sig, expected)
      })
    }
    case 'github': {
      const sig = headers['x-hub-signature-256'] ?? ''
      return /^sha256=[0-9a-f]{64}$/.test(sig) && sameDigest(sig, `sha256=${await hmacHex(secret, body)}`)
    }
    case 'sentry': {
      const sig = headers['sentry-hook-signature'] ?? ''
      return /^[0-9a-f]{64}$/.test(sig) && sameDigest(sig, await hmacHex(secret, body))
    }
    case 'linear': {
      const sig = headers['linear-signature'] ?? ''
      if (!/^[0-9a-f]{64}$/.test(sig) || !sameDigest(sig, await hmacHex(secret, body))) return false
      try {
        const at = Number((JSON.parse(body) as { webhookTimestamp?: number }).webhookTimestamp)
        return !Number.isFinite(at) || Math.abs(Date.now() - at) <= LINEAR_SKEW_MS
      } catch {
        return true
      }
    }
    case 'pagerduty': {
      const expected = `v1=${await hmacHex(secret, body)}`
      return (headers['x-pagerduty-signature'] ?? '').split(',').some((s) => sameDigest(s.trim(), expected))
    }
    case 'stripe': {
      const parts = (headers['stripe-signature'] ?? '').split(',').map((p) => p.trim().split('='))
      const t = parts.find(([k]) => k === 't')?.[1]
      if (!t || !withinSkew(Number(t))) return false
      const expected = await hmacHex(secret, `${t}.${body}`)
      return parts.some(([k, v]) => k === 'v1' && v !== undefined && sameDigest(v, expected))
    }
  }
}

/** A new secret for a sender, as the Hub generates it: Standard Webhooks' `whsec_` form, else hex. */
export function generateSecret(adapter: WebhookAdapterId): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24))
  if (adapter === 'standard') {
    let raw = ''
    for (const b of bytes) raw += String.fromCharCode(b)
    return `whsec_${btoa(raw)}`
  }
  return [...bytes, ...crypto.getRandomValues(new Uint8Array(8))].map((b) => b.toString(16).padStart(2, '0')).join('')
}
