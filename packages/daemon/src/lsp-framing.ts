// LSP's wire format over stdio: `Content-Length: <bytes>\r\n\r\n<json>`, one message after another.

const encoder = new TextEncoder()
const decoder = new TextDecoder()
const HEADER_END = [13, 10, 13, 10]
/** A header block this long without an end is not LSP; the stream is dropped rather than buffered forever. */
const MAX_HEADER_BYTES = 8 * 1024

export function encodeLspMessage(message: unknown): Uint8Array {
  const body = encoder.encode(JSON.stringify(message))
  const header = encoder.encode(`Content-Length: ${body.byteLength}\r\n\r\n`)
  const out = new Uint8Array(header.byteLength + body.byteLength)
  out.set(header)
  out.set(body, header.byteLength)
  return out
}

/** Turns a byte stream that arrives in arbitrary pieces back into messages. */
export class LspMessageReader {
  private buffer = new Uint8Array(0)

  /** The messages completed by `chunk`; throws on a stream that is not LSP. */
  push(chunk: Uint8Array): unknown[] {
    const joined = new Uint8Array(this.buffer.byteLength + chunk.byteLength)
    joined.set(this.buffer)
    joined.set(chunk, this.buffer.byteLength)
    this.buffer = joined
    const messages: unknown[] = []
    for (;;) {
      const headerEnd = indexOf(this.buffer, HEADER_END)
      if (headerEnd === -1) {
        if (this.buffer.byteLength > MAX_HEADER_BYTES) throw new Error('language server sent no message header')
        break
      }
      const header = decoder.decode(this.buffer.subarray(0, headerEnd))
      const length = /^content-length:\s*(\d+)\s*$/im.exec(header)?.[1]
      if (length === undefined) throw new Error(`language server sent a header without Content-Length: ${header.slice(0, 80)}`)
      const start = headerEnd + HEADER_END.length
      const end = start + Number(length)
      if (this.buffer.byteLength < end) break
      // Lengths are bytes, so a multi-byte character split across chunks is whole again here.
      messages.push(JSON.parse(decoder.decode(this.buffer.subarray(start, end))))
      this.buffer = this.buffer.slice(end)
    }
    return messages
  }
}

function indexOf(haystack: Uint8Array, needle: number[]): number {
  outer: for (let i = 0; i <= haystack.byteLength - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) if (haystack[i + j] !== needle[j]) continue outer
    return i
  }
  return -1
}
