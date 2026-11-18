// The parts of the Language Server Protocol the editor uses, as plain shapes. Written out here
// rather than taken from a package: only types are needed, and only these.

export interface LspPosition {
  line: number
  character: number
}

export interface LspRange {
  start: LspPosition
  end: LspPosition
}

export interface LspLocation {
  uri: string
  range: LspRange
}

export interface LspLocationLink {
  originSelectionRange?: LspRange
  targetUri: string
  targetRange: LspRange
  targetSelectionRange: LspRange
}

export interface LspMarkupContent {
  kind: 'plaintext' | 'markdown'
  value: string
}

/** Hover text in any of the forms servers still send. */
export type LspMarkedString = string | { language: string; value: string }

export interface LspTextEdit {
  range: LspRange
  newText: string
}

export interface LspInsertReplaceEdit {
  insert: LspRange
  replace: LspRange
  newText: string
}

export interface LspCommand {
  title: string
  command: string
  arguments?: unknown[]
}

export interface LspDiagnostic {
  range: LspRange
  severity?: number
  code?: number | string
  codeDescription?: { href: string }
  source?: string
  message: string
  tags?: number[]
  relatedInformation?: { location: LspLocation; message: string }[]
  data?: unknown
}

export interface LspCompletionItem {
  label: string
  labelDetails?: { detail?: string; description?: string }
  kind?: number
  tags?: number[]
  detail?: string
  documentation?: string | LspMarkupContent
  deprecated?: boolean
  preselect?: boolean
  sortText?: string
  filterText?: string
  insertText?: string
  insertTextFormat?: number
  insertTextMode?: number
  textEdit?: LspTextEdit | LspInsertReplaceEdit
  textEditText?: string
  additionalTextEdits?: LspTextEdit[]
  commitCharacters?: string[]
  command?: LspCommand
  data?: unknown
}

export interface LspCompletionList {
  isIncomplete: boolean
  itemDefaults?: {
    commitCharacters?: string[]
    editRange?: LspRange | { insert: LspRange; replace: LspRange }
    insertTextFormat?: number
    insertTextMode?: number
    data?: unknown
  }
  items: LspCompletionItem[]
}

export interface LspHover {
  contents: LspMarkupContent | LspMarkedString | LspMarkedString[]
  range?: LspRange
}

export interface LspSignatureHelp {
  signatures: {
    label: string
    documentation?: string | LspMarkupContent
    parameters?: { label: string | [number, number]; documentation?: string | LspMarkupContent }[]
    activeParameter?: number | null
  }[]
  activeSignature?: number
  activeParameter?: number | null
}

export interface LspDocumentHighlight {
  range: LspRange
  kind?: number
}

export interface LspDocumentSymbol {
  name: string
  detail?: string
  kind: number
  tags?: number[]
  deprecated?: boolean
  range: LspRange
  selectionRange: LspRange
  children?: LspDocumentSymbol[]
}

export interface LspSymbolInformation {
  name: string
  kind: number
  tags?: number[]
  deprecated?: boolean
  location: LspLocation
  containerName?: string
}

export interface LspTextDocumentEdit {
  textDocument: { uri: string; version?: number | null }
  edits: LspTextEdit[]
}

export type LspResourceOperation =
  | { kind: 'create'; uri: string; options?: { overwrite?: boolean; ignoreIfExists?: boolean } }
  | { kind: 'rename'; oldUri: string; newUri: string; options?: { overwrite?: boolean; ignoreIfExists?: boolean } }
  | { kind: 'delete'; uri: string; options?: { recursive?: boolean; ignoreIfNotExists?: boolean } }

export interface LspWorkspaceEdit {
  changes?: Record<string, LspTextEdit[]>
  documentChanges?: (LspTextDocumentEdit | LspResourceOperation)[]
}

export interface LspCodeAction {
  title: string
  kind?: string
  diagnostics?: LspDiagnostic[]
  isPreferred?: boolean
  disabled?: { reason: string }
  edit?: LspWorkspaceEdit
  command?: LspCommand
  data?: unknown
}

export interface LspDocumentDiagnosticReport {
  kind: 'full' | 'unchanged'
  resultId?: string
  items?: LspDiagnostic[]
}
