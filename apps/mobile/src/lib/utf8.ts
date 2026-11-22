// UTF-8 TextEncoder/TextDecoder stand-ins for JavaScript engines without them (Hermes has had
// TextEncoder for a while but not always TextDecoder). The pairing link and signatures need both.

export function utf8Encode(text: string): Uint8Array {
  const out: number[] = []
  for (const char of text) {
    const code = char.codePointAt(0)!
    if (code < 0x80) out.push(code)
    else if (code < 0x800) out.push(0xc0 | (code >> 6), 0x80 | (code & 63))
    else if (code < 0x10000) out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63))
    else out.push(0xf0 | (code >> 18), 0x80 | ((code >> 12) & 63), 0x80 | ((code >> 6) & 63), 0x80 | (code & 63))
  }
  return Uint8Array.from(out)
}

export function utf8Decode(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; ) {
    const b = bytes[i]!
    const extra = b >= 0xf0 ? 3 : b >= 0xe0 ? 2 : b >= 0xc0 ? 1 : 0
    let code = extra === 0 ? b : b & (0x3f >> extra)
    for (let k = 1; k <= extra; k++) code = (code << 6) | ((bytes[i + k] ?? 0) & 63)
    out += String.fromCodePoint(b >= 0x80 && extra === 0 ? 0xfffd : code)
    i += extra + 1
  }
  return out
}

/** Installs the stand-ins only where the engine has none. */
export function installTextCodecs(target: Record<string, unknown> = globalThis as unknown as Record<string, unknown>): void {
  if (typeof target.TextEncoder !== 'function') {
    target.TextEncoder = class {
      readonly encoding = 'utf-8'
      encode(text = ''): Uint8Array {
        return utf8Encode(text)
      }
    }
  }
  if (typeof target.TextDecoder !== 'function') {
    target.TextDecoder = class {
      readonly encoding = 'utf-8'
      decode(input?: ArrayBuffer | ArrayBufferView): string {
        if (!input) return ''
        const bytes = input instanceof ArrayBuffer ? new Uint8Array(input) : new Uint8Array(input.buffer, input.byteOffset, input.byteLength)
        return utf8Decode(bytes)
      }
    }
  }
}
