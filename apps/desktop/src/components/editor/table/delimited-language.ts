import type * as Monaco from 'monaco-editor'
import { monaco } from '@/lib/monaco-setup'
import { t } from '@/i18n/i18n'
import LintWorker from './delimited-lint.worker?worker'
import type { LintRequest, LintResult } from './delimited-lint.worker'
import { SNIFF_CHARS, readRecord, sniffDelimiter, type Delimiter } from './delimited-scan'

// Delimited text in the source editor: every column in its own colour ("rainbow CSV"), a hover
// that names the column under the pointer, and squiggles on rows that do not fit the first row
// and on a quote that is never closed. Imported once, by editor-builtins, for its registrations.

/** Above this many characters a file is coloured but not checked: each check reads the file from the top. */
export const LINT_MAX_CHARS = 20 * 1024 * 1024
/** Squiggles drawn for uneven rows; the rest are counted in one last marker. */
const LINT_MAX_MARKERS = 500
/** The hover reads the file up to the pointer to know its column; past this many characters it stays quiet. */
const HOVER_MAX_CHARS = 2 * 1024 * 1024
const MARKER_OWNER = 'delimited-text'

// One language per delimiter, since the colouring has to know it. A file starts in the language
// of its extension and moves to the one its content reads as (see settle).
const LANGUAGES: { id: string; delimiter: Delimiter; extensions: string[]; aliases: string[] }[] = [
  { id: 'csv', delimiter: ',', extensions: ['.csv', '.dsv'], aliases: ['CSV'] },
  { id: 'tsv', delimiter: '\t', extensions: ['.tsv', '.tab'], aliases: ['TSV'] },
  { id: 'csv-semicolon', delimiter: ';', extensions: ['.ssv'], aliases: ['CSV (semicolon)'] },
  { id: 'csv-pipe', delimiter: '|', extensions: ['.psv'], aliases: ['CSV (pipe)'] }
]

function delimiterOf(languageId: string): Delimiter | null {
  return LANGUAGES.find((language) => language.id === languageId)?.delimiter ?? null
}

// Token names start with a kind every Monaco theme colours, so the columns still differ under a
// theme that knows nothing of the rules below.
const COLUMN_TOKENS = ['keyword', 'string', 'number', 'type', 'regexp', 'annotation', 'attribute.name', 'constant'].map(
  (kind, index) => `${kind}.rainbow${index + 1}`
)
// Eight hues told apart by more than lightness, at 4.5:1 or better on each theme's background.
const LIGHT_COLOURS = ['0b5cad', 'a3360b', '0f7b3f', '7b3fb5', 'b0125b', '0a7c86', '8a6100', '5b6470']
const DARK_COLOURS = ['79c0ff', 'ffa657', '7ee787', 'd2a8ff', 'ff9bce', '56d4dd', 'e3c66a', 'b1bac4']

const QUOTE = 34

/** Where a line starts: in which column, and whether inside a quoted field that began on an earlier line. */
class RowState implements Monaco.languages.IState {
  constructor(
    readonly column: number,
    readonly quoted: boolean
  ) {}

  clone(): RowState {
    return this
  }

  equals(other: Monaco.languages.IState): boolean {
    return other instanceof RowState && other.column === this.column && other.quoted === this.quoted
  }
}

const ROW_START = new RowState(0, false)

function tokensProvider(delimiter: Delimiter): Monaco.languages.TokensProvider {
  const code = delimiter.charCodeAt(0)
  return {
    getInitialState: () => ROW_START,
    tokenize(line, state) {
      let { column, quoted } = state as RowState
      const tokens: Monaco.languages.IToken[] = [{ startIndex: 0, scopes: COLUMN_TOKENS[column % COLUMN_TOKENS.length] }]
      let fieldStart = quoted ? -1 : 0
      let i = 0
      while (i < line.length) {
        if (quoted) {
          const close = line.indexOf('"', i)
          if (close === -1) break
          if (line.charCodeAt(close + 1) === QUOTE) i = close + 2
          else {
            quoted = false
            i = close + 1
          }
          continue
        }
        const c = line.charCodeAt(i)
        i++
        if (c === code) {
          // The delimiter keeps the colour of the field it ends.
          column++
          fieldStart = i
          if (i < line.length) tokens.push({ startIndex: i, scopes: COLUMN_TOKENS[column % COLUMN_TOKENS.length] })
        } else if (c === QUOTE && i - 1 === fieldStart) quoted = true
      }
      return { tokens, endState: quoted ? new RowState(column, true) : ROW_START }
    }
  }
}

/** The index of the field the end of `text` is in, counted from the start of its row. */
function columnAtEnd(text: string, delimiter: Delimiter): number {
  const code = delimiter.charCodeAt(0)
  let column = 0
  let quoted = false
  let fieldStart = 0
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    if (quoted) {
      if (c !== QUOTE) continue
      if (text.charCodeAt(i + 1) === QUOTE) i++
      else quoted = false
    } else if (c === code) {
      column++
      fieldStart = i + 1
    } else if (c === 10 || c === 13) {
      column = 0
      fieldStart = i + 1
    } else if (c === QUOTE && i === fieldStart) quoted = true
  }
  return column
}

const hoverProvider: Monaco.languages.HoverProvider = {
  provideHover(model, position) {
    const delimiter = delimiterOf(model.getLanguageId())
    if (!delimiter || model.getOffsetAt(position) > HOVER_MAX_CHARS) return null
    const column = columnAtEnd(model.getValueInRange({ startLineNumber: 1, startColumn: 1, endLineNumber: position.lineNumber, endColumn: position.column }), delimiter)
    const name = readRecord(headOf(model), 0, delimiter, column + 1)[column]
    const label = t('Column {n}', { n: column + 1 })
    // The first row's value as a code span, so nothing in it is read as Markdown.
    const quoted = name && position.lineNumber > 1 ? ` · \`\`${name.replace(/`/g, "'").replace(/\s+/g, ' ').slice(0, 120)}\`\`` : ''
    return { contents: [{ value: `${label}${quoted}` }] }
  }
}

/** The start of a model's text: what the delimiter is guessed from and the first row is read from. */
function headOf(model: Monaco.editor.ITextModel): string {
  if (model.getValueLength() <= SNIFF_CHARS) return model.getValue()
  const end = model.getPositionAt(SNIFF_CHARS + 1)
  return model.getValueInRange({ startLineNumber: 1, startColumn: 1, endLineNumber: end.lineNumber, endColumn: end.column })
}

// Delimiters the table reads files with (it lets the person override the guess), by the tail of
// the model's path, so the source follows the table rather than guessing on its own.
const chosen = new Map<string, Delimiter>()
const MAX_CHOSEN = 200

function chosenFor(model: Monaco.editor.ITextModel): Delimiter | null {
  for (const [tail, delimiter] of chosen) if (model.uri.path.endsWith(tail)) return delimiter
  return null
}

/** Puts a model in the language of the delimiter its file is read with. */
function settle(model: Monaco.editor.ITextModel): void {
  const current = delimiterOf(model.getLanguageId())
  if (!current) return
  const delimiter = chosenFor(model) ?? sniffDelimiter(headOf(model), current)
  if (delimiter !== current) monaco.editor.setModelLanguage(model, LANGUAGES.find((language) => language.delimiter === delimiter)!.id)
}

/** Tells the source which delimiter the table reads a file with, so both colour and count the same columns. */
export function showSourceDelimiter(workspaceId: string, path: string, delimiter: Delimiter): void {
  const tail = `/${workspaceId}/${path}`
  chosen.delete(tail)
  if (chosen.size >= MAX_CHOSEN) chosen.delete(chosen.keys().next().value!)
  chosen.set(tail, delimiter)
  for (const model of monaco.editor.getModels()) if (model.uri.path.endsWith(tail)) settle(model)
}

// Structure checks.
let lintWorker: Worker | null = null
let lintSequence = 0
const lintRuns = new Map<number, { model: Monaco.editor.ITextModel; version: number }>()
const watched = new Map<Monaco.editor.ITextModel, { timer: number | undefined; changes: Monaco.IDisposable }>()

function lineMarker(model: Monaco.editor.ITextModel, line: number, severity: Monaco.MarkerSeverity, message: string, startColumn = 1): Monaco.editor.IMarkerData {
  const lineNumber = Math.min(line, model.getLineCount())
  // An empty range draws nothing, so an empty line is marked up to its (absent) first character.
  return { severity, message, startLineNumber: lineNumber, startColumn, endLineNumber: lineNumber, endColumn: Math.max(startColumn + 1, model.getLineMaxColumn(lineNumber)) }
}

function showLint(result: LintResult): void {
  const run = lintRuns.get(result.id)
  lintRuns.delete(result.id)
  // A result for text that has since been edited would land on the wrong lines; the edit's own check follows.
  if (!run || run.model.isDisposed() || run.model.getVersionId() !== run.version) return
  const { model } = run
  const markers = result.uneven.map(({ line, fields }) =>
    lineMarker(model, line, monaco.MarkerSeverity.Warning, t('This row has {fields} fields; the first row has {expected}.', { fields, expected: result.expected }))
  )
  if (result.unevenTotal > result.uneven.length && result.uneven.length > 0) {
    markers.push(
      lineMarker(
        model,
        result.uneven[result.uneven.length - 1].line,
        monaco.MarkerSeverity.Info,
        t('{count} more rows with a different field count are not marked.', { count: (result.unevenTotal - result.uneven.length).toLocaleString() })
      )
    )
  }
  if (result.unterminated) {
    markers.push(
      lineMarker(
        model,
        result.unterminated.line,
        monaco.MarkerSeverity.Error,
        t('This quote is never closed, so the rest of the file is read as one field.'),
        result.unterminated.column
      )
    )
  }
  monaco.editor.setModelMarkers(model, MARKER_OWNER, markers)
}

function lint(model: Monaco.editor.ITextModel): void {
  const delimiter = delimiterOf(model.getLanguageId())
  if (model.isDisposed() || !delimiter) return
  if (model.getValueLength() > LINT_MAX_CHARS) {
    monaco.editor.setModelMarkers(model, MARKER_OWNER, [
      lineMarker(
        model,
        1,
        monaco.MarkerSeverity.Info,
        t('Rows are not checked here in files over {size}. The table view still counts uneven rows and open quotes.', {
          size: `${LINT_MAX_CHARS / (1024 * 1024)} MB`
        })
      )
    ])
    return
  }
  if (!lintWorker) {
    lintWorker = new LintWorker()
    lintWorker.onmessage = (event: MessageEvent<LintResult>) => showLint(event.data)
  }
  const id = ++lintSequence
  lintRuns.set(id, { model, version: model.getVersionId() })
  lintWorker.postMessage({ id, text: model.getValue(), delimiter, limit: LINT_MAX_MARKERS } satisfies LintRequest)
}

function schedule(model: Monaco.editor.ITextModel, delay: number): void {
  const entry = watched.get(model)
  if (!entry) return
  window.clearTimeout(entry.timer)
  entry.timer = window.setTimeout(() => lint(model), delay)
}

/** Starts or stops checking a model as its language comes to be, or stops being, one of these. */
function follow(model: Monaco.editor.ITextModel): void {
  const ours = delimiterOf(model.getLanguageId()) !== null
  const entry = watched.get(model)
  if (!ours) {
    if (!entry) return
    window.clearTimeout(entry.timer)
    entry.changes.dispose()
    watched.delete(model)
    if (!model.isDisposed()) monaco.editor.setModelMarkers(model, MARKER_OWNER, [])
    return
  }
  if (!entry) {
    // The pause before a check grows with the file: typing should not queue a megabyte per keystroke.
    const changes = model.onDidChangeContent(() => schedule(model, model.getValueLength() < 1024 * 1024 ? 300 : 800))
    watched.set(model, { timer: undefined, changes })
  }
  schedule(model, 0)
}

function unfollow(model: Monaco.editor.ITextModel): void {
  const entry = watched.get(model)
  if (!entry) return
  window.clearTimeout(entry.timer)
  entry.changes.dispose()
  watched.delete(model)
}

// Registration. A hot reload runs this module again, so what the last run registered goes first.
const REGISTERED = '__delimitedTextLanguage'
const globals = globalThis as unknown as Record<string, Monaco.IDisposable[] | undefined>
for (const disposable of globals[REGISTERED] ?? []) disposable.dispose()
const registered: Monaco.IDisposable[] = []
globals[REGISTERED] = registered

for (const language of LANGUAGES) {
  monaco.languages.register({ id: language.id, extensions: language.extensions, aliases: language.aliases })
  registered.push(
    monaco.languages.setTokensProvider(language.id, tokensProvider(language.delimiter)),
    monaco.languages.setLanguageConfiguration(language.id, {
      autoClosingPairs: [{ open: '"', close: '"' }],
      surroundingPairs: [{ open: '"', close: '"' }]
    }),
    monaco.languages.registerHoverProvider(language.id, hoverProvider)
  )
}

// The column colours join the two themes the editors use; defining a built-in theme under its own
// name extends it.
monaco.editor.defineTheme('vs', {
  base: 'vs',
  inherit: true,
  rules: COLUMN_TOKENS.map((token, index) => ({ token, foreground: LIGHT_COLOURS[index] })),
  colors: {}
})
monaco.editor.defineTheme('vs-dark', {
  base: 'vs-dark',
  inherit: true,
  rules: COLUMN_TOKENS.map((token, index) => ({ token, foreground: DARK_COLOURS[index] })),
  colors: {}
})

function adopt(model: Monaco.editor.ITextModel): void {
  settle(model)
  follow(model)
}

registered.push(
  monaco.editor.onDidCreateModel(adopt),
  monaco.editor.onDidChangeModelLanguage((event) => follow(event.model)),
  monaco.editor.onWillDisposeModel(unfollow),
  {
    dispose: () => {
      for (const model of [...watched.keys()]) unfollow(model)
      lintWorker?.terminate()
    }
  }
)
for (const model of monaco.editor.getModels()) adopt(model)
