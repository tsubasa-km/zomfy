import { DelimitedDataset, PLAIN_VIEW, isPlainOrder, type ViewSpec } from './delimited-dataset'
import type { FromWorker, LoadProgress, TableCall, ToWorker } from './delimited-protocol'

// The table's worker: reads the file's rows as its text arrives, and answers for whichever
// version of the text the table is showing. Long work (filtering and sorting a large file) runs
// in slices with a pause between them, so a request for the rows on screen is never stuck behind
// it and a newer request can replace it.

interface Held {
  gen: number
  data: DelimitedDataset
  /** The view `data.view` was worked out for; -1 until the first one is. */
  viewId: number
  parseMs: number
}

const scope = self as unknown as { postMessage(message: FromWorker): void; addEventListener(type: 'message', listener: (event: MessageEvent<ToWorker>) => void): void }

/** The version on screen, fully read and with a view worked out. */
let current: Held | null = null
/** The version arriving. */
let loading: Held | null = null
let spec: ViewSpec = PLAIN_VIEW
let viewId = 0
/** Bumped whenever a view computation is started or made pointless, which stops the one running. */
let viewJob = 0

const SLICE_MS = 24

const channel = new MessageChannel()
const resumers: (() => void)[] = []
channel.port1.onmessage = () => resumers.shift()?.()
/** Lets the messages that are waiting be handled before going on. */
function pause(): Promise<void> {
  return new Promise((resolve) => {
    resumers.push(resolve)
    channel.port2.postMessage(null)
  })
}

/** Runs sliced work to its end; null when `alive` turned false on the way. */
async function drive<T>(steps: Generator<void, T>, alive: () => boolean): Promise<{ value: T } | null> {
  let sliceStart = performance.now()
  for (;;) {
    const step = steps.next()
    if (step.done) return { value: step.value }
    if (performance.now() - sliceStart > SLICE_MS) {
      await pause()
      if (!alive()) return null
      sliceStart = performance.now()
    }
  }
}

function progress(held: Held): LoadProgress {
  const { data } = held
  return {
    type: 'progress',
    gen: held.gen,
    rows: data.rows,
    columns: data.columns,
    expected: data.expected,
    unevenRows: data.unevenRows,
    unterminated: data.unterminated,
    chars: data.length,
    delimiter: data.delimiter,
    done: data.done,
    parseMs: held.parseMs
  }
}

/** Works out the latest view for a fully read version and puts that version on screen. */
async function showView(held: Held): Promise<void> {
  const job = ++viewJob
  const id = viewId
  const started = performance.now()
  const done = await drive(held.data.computeView(spec), () => job === viewJob)
  if (!done) return
  held.data.view = done.value
  held.viewId = id
  if (loading === held) {
    current = held
    loading = null
  }
  scope.postMessage({
    type: 'view',
    gen: held.gen,
    viewId: id,
    count: done.value.count,
    sortType: done.value.sortType,
    plainTextSort: done.value.plainTextSort,
    computeMs: performance.now() - started
  })
}

/** The version a request about (gen, viewId) can be answered from, if it is still here. */
function holder(gen: number, id: number): Held | null {
  if (current && current.gen === gen && current.viewId === id) return current
  // A version still arriving shows its rows in file order as they come.
  if (loading && loading.gen === gen && id === viewId && isPlainOrder(spec)) return loading
  return null
}

async function answer(held: Held, call: TableCall): Promise<unknown> {
  const { data } = held
  const alive = (): boolean => current === held || loading === held
  switch (call.op) {
    case 'cell':
      return data.cell(call.row, call.column)
    case 'locate':
      return data.locate(call.row, call.column)
    case 'sample':
      return data.sample(call.columns, call.rows)
    case 'widest':
      return (await drive(data.widest(call.column), alive))?.value ?? null
    case 'copy': {
      const copied = await drive(data.copy(call.range, call.withNames), alive)
      return copied ? { text: copied.value, tooLarge: copied.value === null } : null
    }
  }
}

scope.addEventListener('message', (event) => {
  const message = event.data
  switch (message.type) {
    case 'begin':
      viewJob++
      loading = { gen: message.gen, data: new DelimitedDataset(message.delimiter, message.fallback), viewId: -1, parseMs: 0 }
      loading.data.view = { ...loading.data.view, spec: { ...PLAIN_VIEW, header: spec.header } }
      if (!message.keep) current = null
      break
    case 'chunk':
    case 'end': {
      if (loading?.gen !== message.gen) break
      const started = performance.now()
      if (message.type === 'chunk') loading.data.push(message.text)
      else loading.data.finish()
      loading.parseMs += performance.now() - started
      scope.postMessage(progress(loading))
      if (message.type === 'end') void showView(loading)
      break
    }
    case 'view':
      spec = message.spec
      viewId = message.viewId
      if (loading) {
        loading.data.view = { ...loading.data.view, spec: { ...PLAIN_VIEW, header: spec.header } }
        // Fully read and waiting on a view that has just been replaced.
        if (loading.data.done) void showView(loading)
        else viewJob++
      } else if (current) void showView(current)
      break
    case 'blocks': {
      const held = holder(message.gen, message.viewId)
      scope.postMessage({
        type: 'blocks',
        requestId: message.requestId,
        gen: message.gen,
        viewId: message.viewId,
        blocks: held ? message.blocks.map(([rowBlock, colBlock]) => held.data.block(rowBlock, colBlock)) : null
      })
      break
    }
    case 'call': {
      const held = holder(message.gen, message.viewId)
      if (!held) scope.postMessage({ type: 'result', requestId: message.requestId, value: null })
      else void answer(held, message.call).then((value) => scope.postMessage({ type: 'result', requestId: message.requestId, value }))
      break
    }
  }
})
