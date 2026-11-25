import { log } from './log.ts'

// Codex App Server uses newline-delimited JSON-RPC envelopes with no "jsonrpc" property.
export type CodexFields = Record<string, unknown>
type RequestId = number | string
type Pending = { resolve: (value: CodexFields) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }

const REQUEST_TIMEOUT_MS = 60_000
const MAX_LINE_CHARS = 32 * 1024 * 1024

/** The server answered a request with a JSON-RPC error: the request failed, the connection is fine. */
export class CodexRpcError extends Error {}

export function fields(value: unknown): CodexFields {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as CodexFields : {}
}

export function string(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

export function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

export class CodexAppServerRpc {
  private readonly writer: WritableStreamDefaultWriter<Uint8Array>
  private readonly encoder = new TextEncoder()
  private readonly pending = new Map<number, Pending>()
  private nextId = 0
  private closeError: Error | null = null
  private updates: Promise<void> = Promise.resolve()
  readonly drained: Promise<void>

  constructor(
    input: WritableStream<Uint8Array>,
    output: ReadableStream<Uint8Array>,
    private readonly notify: (method: string, params: CodexFields) => Promise<void>,
    private readonly ask: (method: string, params: CodexFields) => Promise<unknown>,
    private readonly onClose: (error: Error) => void
  ) {
    this.writer = input.getWriter()
    this.drained = this.read(output)
  }

  async request(method: string, params: CodexFields): Promise<CodexFields> {
    if (this.closeError) throw this.closeError
    const id = ++this.nextId
    const response = Promise.withResolvers<CodexFields>()
    const timer = setTimeout(() => {
      this.pending.delete(id)
      response.reject(new Error(`Codex App Server timed out answering ${method}`))
    }, REQUEST_TIMEOUT_MS)
    this.pending.set(id, { resolve: response.resolve, reject: response.reject, timer })
    void this.send({ id, method, params }).catch((error: unknown) => this.close(asError(error)))
    return response.promise
  }

  get closed(): boolean {
    return this.closeError !== null
  }

  initialized(): Promise<void> {
    return this.send({ method: 'initialized', params: {} })
  }

  close(error = new Error('Codex App Server closed the connection')): void {
    if (this.closed) return
    this.closeError = error
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(error)
    }
    this.pending.clear()
    this.onClose(error)
  }

  private async read(output: ReadableStream<Uint8Array>): Promise<void> {
    const decoder = new TextDecoder()
    let line = ''
    try {
      for await (const bytes of output) {
        line += decoder.decode(bytes, { stream: true })
        let end: number
        while ((end = line.indexOf('\n')) !== -1) {
          this.receive(line.slice(0, end))
          line = line.slice(end + 1)
        }
        if (line.length > MAX_LINE_CHARS) throw new Error('Codex App Server sent an oversized frame')
      }
      this.receive(line + decoder.decode())
      await this.updates
      this.close()
    } catch (error) {
      this.close(asError(error))
    }
  }

  private receive(line: string): void {
    if (!line.trim() || this.closed) return
    if (line.length > MAX_LINE_CHARS) throw new Error('Codex App Server sent an oversized frame')
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      // A stray line (a warning printed to stdout) is not a frame; the connection goes on.
      log(`Codex App Server sent a line that is not JSON: ${line.slice(0, 200)}`)
      return
    }
    const message = fields(parsed)
    const id = message.id
    const method = string(message.method)
    const params = fields(message.params)
    if (method) {
      if (typeof id === 'number' || typeof id === 'string') {
        // An ask follows the notifications before it (its item's tool call), but is not waited for:
        // later notifications (an interrupt's turn/completed) go on while the person decides.
        this.updates = this.updates.then(() => {
          if (!this.closed) void this.answer(id, method, params).catch((error: unknown) => this.close(asError(error)))
        })
      } else {
        this.updates = this.updates.then(async () => {
          if (!this.closed) await this.notify(method, params)
        }).catch((error: unknown) => this.close(asError(error)))
      }
      return
    }
    if (typeof id !== 'number') return
    const pending = this.pending.get(id)
    if (!pending) return
    this.pending.delete(id)
    clearTimeout(pending.timer)
    if (message.error) pending.reject(new CodexRpcError(string(fields(message.error).message) || 'Codex App Server rejected the request'))
    else pending.resolve(fields(message.result))
  }

  private async answer(id: RequestId, method: string, params: CodexFields): Promise<void> {
    let message: CodexFields
    try {
      message = { id, result: await this.ask(method, params) }
    } catch (error) {
      message = { id, error: { code: -32603, message: asError(error).message } }
    }
    if (!this.closed) await this.send(message)
  }

  private send(message: CodexFields): Promise<void> {
    if (this.closeError) return Promise.reject(this.closeError)
    return this.writer.write(this.encoder.encode(JSON.stringify(message) + '\n'))
  }
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}
