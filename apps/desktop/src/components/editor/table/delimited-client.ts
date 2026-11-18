import TableWorker from './delimited.worker?worker'
import { CHUNK_CHARS, COL_BLOCK, PLAIN_VIEW, ROW_BLOCK, isPlainOrder, type CellBlock, type ViewSpec } from './delimited-dataset'
import type { CallResult, FromWorker, LoadProgress, TableCall, ToWorker, ViewReady } from './delimited-protocol'
import type { Delimiter } from './delimited-scan'

// The table's side of its worker: sends the text over in pieces, keeps the cells that have come
// back, and knows which version of the text and which view is on screen.

/** Up to this size the version on screen stays answerable while an edited one is read, so typing in a small file never blanks the table. Above it the worker would hold the file twice. */
const KEEP_WHILE_RELOADING_MAX_CHARS = 16 * 1024 * 1024
const MAX_CACHED_BLOCKS = 400

function blockKey(rowBlock: number, colBlock: number): string {
  return `${rowBlock}:${colBlock}`
}

export class TableSource {
  /** How far the version on screen has been read. */
  status: LoadProgress | null = null
  /** The view on screen, once its version is fully read. */
  view: ViewReady | null = null
  /** Length of the text last handed to load(). */
  totalChars = 0
  /** Bumps whenever something a render reads has changed. */
  version = 0

  private readonly worker = new TableWorker()
  private readonly listeners = new Set<() => void>()
  private gen = 0
  private shownGen = 0
  private spec: ViewSpec = PLAIN_VIEW
  private wantedViewId = 0
  private blocks = new Map<string, CellBlock>()
  /** Cells of the view or version just replaced, shown until the first new ones arrive so nothing flickers. */
  private stale = new Map<string, CellBlock>()
  private inFlight = false
  private inFlightEpoch = ''
  private nextRequest = 1
  private readonly calls = new Map<number, (value: unknown) => void>()
  private incoming: LoadProgress | null = null
  private disposed = false

  constructor() {
    this.worker.onmessage = (event: MessageEvent<FromWorker>) => this.receive(event.data)
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getVersion = (): number => this.version

  private changed(): void {
    this.version++
    for (const listener of this.listeners) listener()
  }

  private post(message: ToWorker): void {
    this.worker.postMessage(message)
  }

  /** A view newer than the one on screen, or an edited text, is being worked on. */
  get busy(): boolean {
    return this.gen !== this.shownGen || !this.status?.done || this.view?.gen !== this.shownGen || this.view.viewId !== this.wantedViewId
  }

  /** Whether the version on screen is still being read. */
  get reading(): boolean {
    return !this.status?.done
  }

  /** Rows on screen. While a file is first read (no sort or filter) this grows as rows arrive. */
  get rowCount(): number {
    if (this.view && this.view.gen === this.shownGen) return this.view.count
    if (!this.status || !isPlainOrder(this.spec)) return 0
    return Math.max(0, this.status.rows - (this.spec.header ? 1 : 0))
  }

  /** Reads a new version of the text. The pieces go over one per task, so the page stays responsive however large the text is. */
  load(text: string, delimiter: Delimiter | 'auto', fallback: Delimiter): void {
    const gen = ++this.gen
    const keep = this.view?.gen === this.shownGen && this.shownGen !== 0 && text.length <= KEEP_WHILE_RELOADING_MAX_CHARS
    this.totalChars = text.length
    this.post({ type: 'begin', gen, delimiter, fallback, keep })
    if (!keep) this.show(gen, null)
    let sent = 0
    const step = (): void => {
      if (this.disposed || gen !== this.gen) return
      if (sent < text.length) {
        this.post({ type: 'chunk', gen, text: text.slice(sent, sent + CHUNK_CHARS) })
        sent += CHUNK_CHARS
      }
      if (sent < text.length) setTimeout(step, 0)
      else this.post({ type: 'end', gen })
    }
    step()
    this.changed()
  }

  setView(spec: ViewSpec): void {
    this.spec = spec
    this.wantedViewId++
    this.post({ type: 'view', viewId: this.wantedViewId, spec })
    // Rows of a file still arriving are read under the new header setting straight away.
    if (this.view?.gen !== this.shownGen) this.turnOver()
    this.changed()
  }

  /** What requests about the cells on screen are tagged with. */
  private get shownViewId(): number {
    return this.view && this.view.gen === this.shownGen ? this.view.viewId : this.wantedViewId
  }

  private get epoch(): string {
    return `${this.shownGen}:${this.shownViewId}`
  }

  private turnOver(): void {
    if (this.blocks.size > 0) this.stale = this.blocks
    this.blocks = new Map()
    this.inFlight = false
  }

  private show(gen: number, view: ViewReady | null): void {
    this.shownGen = gen
    this.view = view
    this.status = this.incoming?.gen === gen ? this.incoming : null
    this.turnOver()
  }

  private receive(message: FromWorker): void {
    switch (message.type) {
      case 'progress':
        if (message.gen === this.shownGen) this.status = message
        else if (message.gen === this.gen) this.incoming = message
        else return
        break
      case 'view':
        if (message.gen !== this.gen && message.gen !== this.shownGen) return
        if (message.gen !== this.shownGen) this.show(message.gen, message)
        else {
          this.view = message
          this.turnOver()
        }
        break
      case 'blocks':
        if (this.inFlightEpoch !== `${message.gen}:${message.viewId}` || this.inFlightEpoch !== this.epoch) return
        this.inFlight = false
        if (!message.blocks) return
        this.stale = new Map()
        for (const block of message.blocks) {
          const key = blockKey(block.rowBlock, block.colBlock)
          this.blocks.delete(key)
          this.blocks.set(key, block)
        }
        for (const key of this.blocks.keys()) {
          if (this.blocks.size <= MAX_CACHED_BLOCKS) break
          this.blocks.delete(key)
        }
        break
      case 'result':
        this.calls.get(message.requestId)?.(message.value)
        this.calls.delete(message.requestId)
        return
    }
    this.changed()
  }

  /** The cells of one block if they are here (possibly those of the view just replaced). */
  block(rowBlock: number, colBlock: number): CellBlock | undefined {
    const key = blockKey(rowBlock, colBlock)
    return this.blocks.get(key) ?? this.stale.get(key)
  }

  /** Whether a block is here, current and as long as the rows read so far make it. */
  private complete(rowBlock: number, colBlock: number): boolean {
    const block = this.blocks.get(blockKey(rowBlock, colBlock))
    return block !== undefined && block.cells.length >= Math.min(ROW_BLOCK, this.rowCount - rowBlock * ROW_BLOCK)
  }

  /** Asks for the blocks covering a range of the view that are not here yet. One request at a time: what is wanted when it returns may have moved on. */
  want(rowFrom: number, rowTo: number, colFrom: number, colTo: number): void {
    if (this.inFlight || this.shownGen === 0 || rowTo < rowFrom) return
    if (this.view?.gen !== this.shownGen && !isPlainOrder(this.spec)) return
    const missing: [number, number][] = []
    for (let rb = Math.floor(rowFrom / ROW_BLOCK); rb <= Math.floor(rowTo / ROW_BLOCK); rb++) {
      for (let cb = Math.floor(colFrom / COL_BLOCK); cb <= Math.floor(Math.max(colFrom, colTo) / COL_BLOCK); cb++) {
        if (!this.complete(rb, cb)) missing.push([rb, cb])
      }
    }
    if (missing.length === 0) return
    this.inFlight = true
    this.inFlightEpoch = this.epoch
    this.post({ type: 'blocks', requestId: this.nextRequest++, gen: this.shownGen, viewId: this.shownViewId, blocks: missing })
  }

  /** Asks the worker about the view on screen; null when that view has gone by the time it answers. */
  call<C extends TableCall>(call: C): Promise<CallResult<C>> {
    return new Promise((resolve) => {
      const requestId = this.nextRequest++
      this.calls.set(requestId, resolve as (value: unknown) => void)
      this.post({ type: 'call', requestId, gen: this.shownGen, viewId: this.shownViewId, call })
    })
  }

  dispose(): void {
    this.disposed = true
    this.worker.terminate()
    this.listeners.clear()
    for (const resolve of this.calls.values()) resolve(null)
    this.calls.clear()
  }
}
