import { describe, expect, it } from 'vitest'
import { publicOrigin } from '../src/env'

// PUBLIC_URL names the relay's origin behind a tunnel (docs/specs/bots/self-host.md).
describe('publicOrigin', () => {
  it('is the origin of PUBLIC_URL', () => {
    expect(publicOrigin({ PUBLIC_URL: 'https://relay.example.com/' })).toBe('https://relay.example.com')
    expect(publicOrigin({ PUBLIC_URL: ' https://abc.trycloudflare.com/x ' })).toBe('https://abc.trycloudflare.com')
  })

  it('is null when unset or not an http(s) URL', () => {
    expect(publicOrigin({})).toBeNull()
    expect(publicOrigin({ PUBLIC_URL: '' })).toBeNull()
    expect(publicOrigin({ PUBLIC_URL: 'not a url' })).toBeNull()
    expect(publicOrigin({ PUBLIC_URL: 'ftp://relay.example.com' })).toBeNull()
  })
})
