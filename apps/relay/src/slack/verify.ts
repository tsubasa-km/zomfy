// Slack signs every request: HMAC-SHA256 of `v0:<X-Slack-Request-Timestamp>:<raw body>` with the
// app's signing secret, sent as `X-Slack-Signature: v0=<hex>`; a timestamp more than 5 minutes off
// is refused (docs/specs/bots/sources/slack.md#signatures-and-limits).

import { limits } from '../contract'
import { hmacHex, sameDigest } from '../sources/common'

export async function verifySlackRequest(secret: string, signature: string, timestamp: string, body: string, now = Date.now()): Promise<boolean> {
  if (!secret || !/^v0=[0-9a-f]{64}$/.test(signature) || !/^\d{1,12}$/.test(timestamp)) return false
  if (Math.abs(now - Number(timestamp) * 1000) > limits.signedRequestSkewMs) return false
  const expected = `v0=${await hmacHex(secret, `v0:${timestamp}:${body}`)}`
  return sameDigest(expected, signature)
}
