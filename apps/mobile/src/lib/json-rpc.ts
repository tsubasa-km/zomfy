// A JSON-RPC 2.0 peer over any text channel. The phone speaks ACP this way over the gateway's
// WebSocket: it sends requests and notifications, and answers the daemon's own requests
// (`session/request_permission`). No React Native imports, so it runs under `bun test`.

export type JsonValue = unknown

export interface JsonRpcErrorShape {
  code: number
  message: string
  data?: unknown
}

/** A JSON-RPC error answer, or a local failure (closed channel, timeout) in the same shape. */
export class RpcError extends Error {
  readonly code: number
  readonly data: unknown
  constructor(code: number, message: string, data?: unknown) {
    super(message)
    this.name = 'RpcError'
    this.code = code
    this.data = data
  }
}

export const RPC_ERRORS = {
  parse: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  internal: -32603,
  /** Local: the channel closed before the answer came. */
  closed: -32099,
  /** Local: no answer in time. */
  timeout: -32098
} as const

export type RequestHandler = (params: unknown) => unknown | Promise<unknown>
export type NotificationHandler = (method: string, params: unknown) => void

interface Pending {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout> | null
}

export interface RequestOptions {
  /** Rejects with a timeout error after this long; none by default (a prompt runs a whole turn). */
  timeoutMs?: number
}

export class JsonRpcPeer {
  private nextId = 1
  private readonly pending = new Map<number, Pending>()
  private readonly handlers = new Map<string, RequestHandler>()
  private notificationHandler: NotificationHandler = () => {}
  private closedWith: Error | null = null

  constructor(private readonly send: (text: string) => void) {}

  get closed(): boolean {
    return this.closedWith !== null
  }

  request<T = unknown>(method: string, params?: unknown, options: RequestOptions = {}): Promise<T> {
    if (this.closedWith) return Promise.reject(this.closedWith)
    const id = this.nextId++
    return new Promise<T>((resolve, reject) => {
      const timer =
        options.timeoutMs === undefined
          ? null
          : setTimeout(() => {
              this.pending.delete(id)
              reject(new RpcError(RPC_ERRORS.timeout, `${method} timed out`))
            }, options.timeoutMs)
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer })
      try {
        this.send(JSON.stringify({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) }))
      } catch (error) {
        this.settle(id)?.reject(error instanceof Error ? error : new Error(String(error)))
      }
    })
  }

  notify(method: string, params?: unknown): void {
    if (this.closedWith) throw this.closedWith
    this.send(JSON.stringify({ jsonrpc: '2.0', method, ...(params === undefined ? {} : { params }) }))
  }

  /** Answers the other side's requests for `method`; a thrown error goes back as a JSON-RPC error. */
  onRequest(method: string, handler: RequestHandler): void {
    this.handlers.set(method, handler)
  }

  onNotification(handler: NotificationHandler): void {
    this.notificationHandler = handler
  }

  /** Feeds one incoming text frame. */
  receive(text: string): void {
    let message: Record<string, unknown>
    try {
      message = JSON.parse(text) as Record<string, unknown>
    } catch {
      return
    }
    if (!message || typeof message !== 'object') return
    const hasId = typeof message.id === 'number' || typeof message.id === 'string'
    if (typeof message.method === 'string') {
      if (hasId) void this.answer(message.id as number | string, message.method, message.params)
      else this.notificationHandler(message.method, message.params)
      return
    }
    if (!hasId) return
    const pending = this.settle(message.id as number)
    if (!pending) return
    const error = message.error as JsonRpcErrorShape | undefined
    if (error && typeof error === 'object') pending.reject(new RpcError(error.code, error.message, error.data))
    else pending.resolve(message.result)
  }

  /** Rejects every request still waiting; later calls fail at once. */
  close(reason: Error = new RpcError(RPC_ERRORS.closed, 'Connection closed')): void {
    if (this.closedWith) return
    this.closedWith = reason
    for (const [id] of this.pending) this.settle(id)?.reject(reason)
  }

  private settle(id: number): Pending | undefined {
    const pending = this.pending.get(id)
    if (!pending) return undefined
    this.pending.delete(id)
    if (pending.timer) clearTimeout(pending.timer)
    return pending
  }

  private async answer(id: number | string, method: string, params: unknown): Promise<void> {
    const handler = this.handlers.get(method)
    let reply: Record<string, unknown>
    if (!handler) {
      reply = { error: { code: RPC_ERRORS.methodNotFound, message: `Method not found: ${method}` } }
    } else {
      try {
        reply = { result: (await handler(params)) ?? null }
      } catch (error) {
        reply = {
          error: {
            code: error instanceof RpcError ? error.code : RPC_ERRORS.internal,
            message: error instanceof Error ? error.message : String(error)
          }
        }
      }
    }
    if (this.closedWith) return
    try {
      this.send(JSON.stringify({ jsonrpc: '2.0', id, ...reply }))
    } catch {
      // The channel went away while the handler ran; the other side treats the request as dropped.
    }
  }
}
