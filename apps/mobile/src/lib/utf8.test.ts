import { describe, expect, test } from 'bun:test'
import { installTextCodecs, utf8Decode, utf8Encode } from './utf8'

const samples = ['', 'plain ascii', 'ホスト 名前', 'emoji 🙂 and ü', '{"hostName":"鈴木のPC"}']

describe('utf8 stand-ins', () => {
  test('match the platform codecs', () => {
    for (const text of samples) {
      const bytes = new TextEncoder().encode(text)
      expect(utf8Encode(text)).toEqual(bytes)
      expect(utf8Decode(bytes)).toBe(text)
    }
  })

  test('are installed only where missing', () => {
    const target: Record<string, unknown> = {}
    installTextCodecs(target)
    const Decoder = target.TextDecoder as typeof TextDecoder
    const Encoder = target.TextEncoder as typeof TextEncoder
    expect(new Decoder().decode(new Encoder().encode('ペアリング'))).toBe('ペアリング')
    const native = { TextEncoder, TextDecoder } as Record<string, unknown>
    installTextCodecs(native)
    expect(native.TextDecoder).toBe(TextDecoder)
  })
})
