import type * as monaco from 'monaco-editor'
import type {
  LspCommand,
  LspCompletionItem,
  LspCompletionList,
  LspDiagnostic,
  LspDocumentHighlight,
  LspDocumentSymbol,
  LspHover,
  LspInsertReplaceEdit,
  LspLocation,
  LspLocationLink,
  LspMarkedString,
  LspMarkupContent,
  LspPosition,
  LspRange,
  LspResourceOperation,
  LspSignatureHelp,
  LspSymbolInformation,
  LspTextEdit,
  LspWorkspaceEdit
} from './lsp-types'

// LSP ↔ Monaco, as pure functions: no editor is needed to run them, so they are tested on their
// own (tests/lsp-convert.test.ts). Monaco's enums are spelled as numbers here for the same reason;
// that test holds them against Monaco's own tables.
//
// Both sides count columns in UTF-16 code units (the daemon asks servers for `utf-16` positions),
// so a position only changes base: LSP counts lines and characters from 0, Monaco from 1.

type Uri = monaco.Uri
type IRange = monaco.IRange
/** Turns a URI off the wire into the editor's own. */
export type ParseUri = (uri: string) => Uri

export const MONACO_MARKER_SEVERITY = { Hint: 1, Info: 2, Warning: 4, Error: 8 } as const
const INSERT_KEEP_WHITESPACE = 1
const INSERT_AS_SNIPPET = 4

/** Monaco's CompletionItemKind by LSP's (1-based). */
const COMPLETION_KIND: Record<number, number> = {
  1: 18, // Text
  2: 0, // Method
  3: 1, // Function
  4: 2, // Constructor
  5: 3, // Field
  6: 4, // Variable
  7: 5, // Class
  8: 7, // Interface
  9: 8, // Module
  10: 9, // Property
  11: 12, // Unit
  12: 13, // Value
  13: 15, // Enum
  14: 17, // Keyword
  15: 28, // Snippet
  16: 19, // Color
  17: 20, // File
  18: 21, // Reference
  19: 23, // Folder
  20: 16, // EnumMember
  21: 14, // Constant
  22: 6, // Struct
  23: 10, // Event
  24: 11, // Operator
  25: 24 // TypeParameter
}
const COMPLETION_KIND_TEXT = 18

export function toLspPosition(position: monaco.IPosition): LspPosition {
  return { line: position.lineNumber - 1, character: position.column - 1 }
}

export function toMonacoPosition(position: LspPosition): monaco.IPosition {
  return { lineNumber: position.line + 1, column: position.character + 1 }
}

export function toLspRange(range: IRange): LspRange {
  return {
    start: { line: range.startLineNumber - 1, character: range.startColumn - 1 },
    end: { line: range.endLineNumber - 1, character: range.endColumn - 1 }
  }
}

export function toMonacoRange(range: LspRange): IRange {
  return {
    startLineNumber: range.start.line + 1,
    startColumn: range.start.character + 1,
    endLineNumber: range.end.line + 1,
    endColumn: range.end.character + 1
  }
}

// ── Document sync ────────────────────────────────────────────────────────

export interface LspContentChange {
  range: LspRange
  rangeLength: number
  text: string
}

/**
 * One edit's changes as LSP's incremental `contentChanges`. Monaco's ranges all refer to the text
 * before the edit, while a server applies them one after another; sent from the end of the document
 * backwards, no change moves the ones still to come.
 */
export function toLspContentChanges(changes: readonly monaco.editor.IModelContentChange[]): LspContentChange[] {
  return [...changes]
    .sort((a, b) => b.range.startLineNumber - a.range.startLineNumber || b.range.startColumn - a.range.startColumn)
    .map((change) => ({ range: toLspRange(change.range), rangeLength: change.rangeLength, text: change.text }))
}

// ── Diagnostics ──────────────────────────────────────────────────────────

export function toMarkerSeverity(severity: number | undefined): monaco.MarkerSeverity {
  if (severity === 2) return MONACO_MARKER_SEVERITY.Warning
  if (severity === 3) return MONACO_MARKER_SEVERITY.Info
  if (severity === 4) return MONACO_MARKER_SEVERITY.Hint
  return MONACO_MARKER_SEVERITY.Error
}

/** `source` names the server when the diagnostic does not name its own (a linter rule set, say). */
export function toMarker(diagnostic: LspDiagnostic, source: string, parseUri: ParseUri): monaco.editor.IMarkerData {
  const code = diagnostic.code === undefined || diagnostic.code === null ? undefined : String(diagnostic.code)
  const href = diagnostic.codeDescription?.href
  return {
    ...toMonacoRange(diagnostic.range),
    severity: toMarkerSeverity(diagnostic.severity),
    message: diagnostic.message,
    source: diagnostic.source ?? source,
    ...(code !== undefined ? { code: href ? { value: code, target: parseUri(href) } : code } : {}),
    // LSP's tags (1 unnecessary, 2 deprecated) are Monaco's.
    ...(diagnostic.tags?.length ? { tags: diagnostic.tags.filter((tag) => tag === 1 || tag === 2) as monaco.MarkerTag[] } : {}),
    ...(diagnostic.relatedInformation?.length
      ? {
          relatedInformation: diagnostic.relatedInformation.map((related) => ({
            resource: parseUri(related.location.uri),
            message: related.message,
            ...toMonacoRange(related.location.range)
          }))
        }
      : {})
  }
}

/** The server's own diagnostics behind some of the editor's markers, for a code action's context. */
export function diagnosticsForMarkers(markers: readonly monaco.editor.IMarkerData[], known: readonly LspDiagnostic[]): LspDiagnostic[] {
  return known.filter((diagnostic) => {
    const range = toMonacoRange(diagnostic.range)
    return markers.some(
      (marker) =>
        marker.message === diagnostic.message &&
        marker.startLineNumber === range.startLineNumber &&
        marker.startColumn === range.startColumn &&
        marker.endLineNumber === range.endLineNumber &&
        marker.endColumn === range.endColumn
    )
  })
}

// ── Markdown ─────────────────────────────────────────────────────────────

/** Plain text as Markdown that renders as that text. */
function escapeMarkdown(text: string): string {
  return text.replace(/[\\`*_{}[\]()#+\-!~<>|]/g, '\\$&').replace(/\r?\n/g, '  \n')
}

export function toMarkdown(content: string | LspMarkupContent | LspMarkedString): monaco.IMarkdownString {
  if (typeof content === 'string') return { value: content }
  if ('kind' in content) return { value: content.kind === 'markdown' ? content.value : escapeMarkdown(content.value) }
  return { value: `\`\`\`${content.language}\n${content.value}\n\`\`\`` }
}

function toDocumentation(documentation: string | LspMarkupContent | undefined): string | monaco.IMarkdownString | undefined {
  if (documentation === undefined || typeof documentation === 'string') return documentation
  return documentation.kind === 'markdown' ? { value: documentation.value } : documentation.value
}

// ── Completion ───────────────────────────────────────────────────────────

export interface CompletionRanges {
  insert: IRange
  replace: IRange
}

const isInsertReplace = (edit: LspTextEdit | LspInsertReplaceEdit): edit is LspInsertReplaceEdit => 'insert' in edit

/** A server's command as the editor runs it; undefined drops a command the editor cannot run. */
export type ToCommand = (command: LspCommand) => monaco.languages.Command | undefined

/**
 * One completion item. `word` is the word under the cursor, used when the server names no range of
 * its own; `defaults` are the list's shared values (LSP 3.17 `itemDefaults`).
 */
export function toCompletionItem(
  item: LspCompletionItem,
  defaults: LspCompletionList['itemDefaults'],
  word: CompletionRanges,
  toCommand: ToCommand = () => undefined
): monaco.languages.CompletionItem {
  let range: IRange | CompletionRanges = word
  let insertText = item.insertText ?? item.label
  if (item.textEdit) {
    range = isInsertReplace(item.textEdit)
      ? { insert: toMonacoRange(item.textEdit.insert), replace: toMonacoRange(item.textEdit.replace) }
      : toMonacoRange(item.textEdit.range)
    insertText = item.textEdit.newText
  } else if (defaults?.editRange) {
    range =
      'insert' in defaults.editRange
        ? { insert: toMonacoRange(defaults.editRange.insert), replace: toMonacoRange(defaults.editRange.replace) }
        : toMonacoRange(defaults.editRange)
    insertText = item.textEditText ?? insertText
  }
  const snippet = (item.insertTextFormat ?? defaults?.insertTextFormat) === 2
  // Mode 1 is "as is"; otherwise the editor re-indents continuation lines, as VS Code does by default.
  const asIs = (item.insertTextMode ?? defaults?.insertTextMode) === 1
  const rules = (snippet ? INSERT_AS_SNIPPET : 0) | (asIs ? INSERT_KEEP_WHITESPACE : 0)
  const deprecated = item.deprecated === true || item.tags?.includes(1) === true
  const commitCharacters = item.commitCharacters ?? defaults?.commitCharacters
  const documentation = toDocumentation(item.documentation)
  const command = item.command ? toCommand(item.command) : undefined
  return {
    label: item.labelDetails ? { label: item.label, detail: item.labelDetails.detail, description: item.labelDetails.description } : item.label,
    kind: (COMPLETION_KIND[item.kind ?? 1] ?? COMPLETION_KIND_TEXT) as monaco.languages.CompletionItemKind,
    insertText,
    range,
    ...(rules ? { insertTextRules: rules as monaco.languages.CompletionItemInsertTextRule } : {}),
    ...(deprecated ? { tags: [1 as monaco.languages.CompletionItemTag] } : {}),
    ...(item.detail !== undefined ? { detail: item.detail } : {}),
    ...(documentation !== undefined ? { documentation } : {}),
    ...(item.sortText !== undefined ? { sortText: item.sortText } : {}),
    ...(item.filterText !== undefined ? { filterText: item.filterText } : {}),
    ...(item.preselect ? { preselect: true } : {}),
    ...(commitCharacters ? { commitCharacters } : {}),
    ...(item.additionalTextEdits?.length ? { additionalTextEdits: item.additionalTextEdits.map(toSingleEdit) } : {}),
    ...(command ? { command } : {})
  }
}

/** An item to send back for `completionItem/resolve`, with the list's shared `data` put on it. */
export function withDefaultData(item: LspCompletionItem, defaults: LspCompletionList['itemDefaults']): LspCompletionItem {
  return item.data === undefined && defaults?.data !== undefined ? { ...item, data: defaults.data } : item
}

// ── Text edits ───────────────────────────────────────────────────────────

export function toTextEdit(edit: LspTextEdit): monaco.languages.TextEdit {
  return { range: toMonacoRange(edit.range), text: edit.newText }
}

function toSingleEdit(edit: LspTextEdit): monaco.editor.ISingleEditOperation {
  return { range: toMonacoRange(edit.range), text: edit.newText }
}

/** One step of a workspace edit: text edits to one document, or a file created, renamed or deleted. */
export type WorkspaceEditStep = { kind: 'edit'; uri: string; edits: LspTextEdit[] } | LspResourceOperation

/** A workspace edit as steps in the order to carry them out; `documentChanges` wins over `changes` when both are sent. */
export function workspaceEditSteps(edit: LspWorkspaceEdit): WorkspaceEditStep[] {
  if (edit.documentChanges) {
    return edit.documentChanges.map((change): WorkspaceEditStep => ('kind' in change ? change : { kind: 'edit', uri: change.textDocument.uri, edits: change.edits }))
  }
  return Object.entries(edit.changes ?? {}).map(([uri, edits]): WorkspaceEditStep => ({ kind: 'edit', uri, edits }))
}

/** Where each line of `text` starts, by LSP's line ends (`\n`, `\r\n`, `\r`). */
function lineStarts(text: string): number[] {
  const starts = [0]
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i)
    if (ch === 13 && text.charCodeAt(i + 1) === 10) i++
    if (ch === 10 || ch === 13) starts.push(i + 1)
  }
  return starts
}

/**
 * `text` with LSP edits applied, for a file that is not open in an editor. All ranges refer to the
 * original text; edits at the same place land in the order given, and overlapping ones are refused.
 */
export function applyTextEdits(text: string, edits: readonly LspTextEdit[]): string {
  const starts = lineStarts(text)
  const offset = (position: LspPosition): number => {
    if (position.line >= starts.length) return text.length
    const start = starts[position.line]!
    const next = position.line + 1 < starts.length ? starts[position.line + 1]! : text.length + 1
    // A character past the line's end means the line's end, before its line break.
    let end = next - 1
    if (position.line + 1 < starts.length && text.charCodeAt(end) === 10 && text.charCodeAt(end - 1) === 13) end--
    return Math.min(start + position.character, Math.max(start, end))
  }
  const spans = edits.map((edit, index) => ({ start: offset(edit.range.start), end: offset(edit.range.end), text: edit.newText, index })).sort((a, b) => a.start - b.start || a.index - b.index)
  let out = ''
  let last = 0
  for (const span of spans) {
    if (span.start < last) throw new Error('Overlapping edits')
    out += text.slice(last, span.start) + span.text
    last = span.end
  }
  return out + text.slice(last)
}

// ── Hover, signature help ────────────────────────────────────────────────

export function toHover(hover: LspHover): monaco.languages.Hover {
  const contents = Array.isArray(hover.contents) ? hover.contents : [hover.contents]
  return {
    contents: contents.map(toMarkdown).filter((part) => part.value.trim() !== ''),
    ...(hover.range ? { range: toMonacoRange(hover.range) } : {})
  }
}

export function toSignatureHelp(help: LspSignatureHelp): monaco.languages.SignatureHelp {
  const activeSignature = help.activeSignature ?? 0
  return {
    signatures: help.signatures.map((signature) => {
      const documentation = toDocumentation(signature.documentation)
      return {
        label: signature.label,
        ...(documentation !== undefined ? { documentation } : {}),
        parameters: (signature.parameters ?? []).map((parameter) => {
          const doc = toDocumentation(parameter.documentation)
          return { label: parameter.label, ...(doc !== undefined ? { documentation: doc } : {}) }
        }),
        ...(typeof signature.activeParameter === 'number' ? { activeParameter: signature.activeParameter } : {})
      }
    }),
    activeSignature,
    activeParameter: help.signatures[activeSignature]?.activeParameter ?? help.activeParameter ?? 0
  }
}

// ── Navigation ───────────────────────────────────────────────────────────

type LocationResult = LspLocation | LspLocation[] | LspLocationLink[] | null | undefined

const isLink = (location: LspLocation | LspLocationLink): location is LspLocationLink => 'targetUri' in location

/** Where a definition, declaration, implementation or reference request points, in any of LSP's shapes. */
export function toLocations(result: LocationResult, parseUri: ParseUri): monaco.languages.LocationLink[] {
  const list = !result ? [] : Array.isArray(result) ? result : [result]
  return list.map((location) =>
    isLink(location)
      ? {
          uri: parseUri(location.targetUri),
          range: toMonacoRange(location.targetRange),
          targetSelectionRange: toMonacoRange(location.targetSelectionRange),
          ...(location.originSelectionRange ? { originSelectionRange: toMonacoRange(location.originSelectionRange) } : {})
        }
      : { uri: parseUri(location.uri), range: toMonacoRange(location.range) }
  )
}

/** The window URIs a location result names, for loading files that are not open before the editor shows them. */
export function locationUris(result: LocationResult): string[] {
  const list = !result ? [] : Array.isArray(result) ? result : [result]
  return [...new Set(list.map((location) => (isLink(location) ? location.targetUri : location.uri)))]
}

export function toDocumentHighlight(highlight: LspDocumentHighlight): monaco.languages.DocumentHighlight {
  // LSP's kinds are Monaco's plus one (text, read, write).
  return { range: toMonacoRange(highlight.range), ...(highlight.kind ? { kind: (highlight.kind - 1) as monaco.languages.DocumentHighlightKind } : {}) }
}

/** An outline, from either a tree of symbols or the older flat list. */
export function toDocumentSymbols(symbols: readonly (LspDocumentSymbol | LspSymbolInformation)[]): monaco.languages.DocumentSymbol[] {
  return symbols.map((symbol): monaco.languages.DocumentSymbol => {
    const tags = (symbol.deprecated || symbol.tags?.includes(1) ? [1] : []) as monaco.languages.SymbolTag[]
    // LSP's symbol kinds are Monaco's plus one.
    const kind = (symbol.kind - 1) as monaco.languages.SymbolKind
    if ('location' in symbol) {
      const range = toMonacoRange(symbol.location.range)
      return { name: symbol.name, detail: '', kind, tags, range, selectionRange: range, ...(symbol.containerName ? { containerName: symbol.containerName } : {}) }
    }
    return {
      name: symbol.name,
      detail: symbol.detail ?? '',
      kind,
      tags,
      range: toMonacoRange(symbol.range),
      selectionRange: toMonacoRange(symbol.selectionRange),
      ...(symbol.children?.length ? { children: toDocumentSymbols(symbol.children) } : {})
    }
  })
}
