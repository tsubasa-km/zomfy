import { toast } from 'sonner'
import { parseLspDocumentUri } from '@zomfy/protocol'
import { monaco } from '@/lib/monaco-setup'
import { openEditorTab } from '@/session-store'
import { t } from '@/i18n/i18n'
import type { LspSession } from './lsp-client'
import {
  diagnosticsForMarkers,
  locationUris,
  toCompletionItem,
  toDocumentHighlight,
  toDocumentSymbols,
  toHover,
  toLocations,
  toLspPosition,
  toLspRange,
  toMonacoRange,
  toSignatureHelp,
  toTextEdit,
  withDefaultData,
  type ToCommand
} from './lsp-convert'
import { allDocuments, documentOf, onLanguagesChanged, type LspDocument } from './lsp-documents'
import { ensureModels, externalPath, isExternalUri, monacoUri } from './lsp-models'
import { setLanguageServed } from './monaco-builtin-languages'
import type {
  LspCodeAction,
  LspCommand,
  LspCompletionItem,
  LspCompletionList,
  LspDocumentHighlight,
  LspDocumentSymbol,
  LspHover,
  LspLocation,
  LspLocationLink,
  LspRange,
  LspSignatureHelp,
  LspSymbolInformation,
  LspTextEdit,
  LspWorkspaceEdit
} from './lsp-types'
import { applyWorkspaceEditAndReport } from './lsp-workspace-edit'

// Monaco's language features, answered by the language servers behind a model. Providers are
// registered per editor language the first time a server serves one of its files; each asks the
// document's own servers when called and stays silent for a model none serves, so Monaco's other
// providers still answer there.

type Model = monaco.editor.ITextModel
type Token = monaco.CancellationToken

const EXECUTE_COMMAND = 'zomfy.lsp.executeCommand'
const APPLY_CODE_ACTION = 'zomfy.lsp.applyCodeAction'
/** Commands a server may attach that the editor itself runs. */
const EDITOR_COMMANDS = new Set(['editor.action.triggerSuggest', 'editor.action.triggerParameterHints'])

const sessionsById = new Map<string, LspSession>()

function remember(session: LspSession): LspSession {
  sessionsById.set(session.sessionId, session)
  return session
}

function textDocument(doc: LspDocument) {
  return { textDocument: { uri: doc.uri } }
}

function at(doc: LspDocument, position: monaco.IPosition) {
  return { ...textDocument(doc), position: toLspPosition(position) }
}

/** A server's command as something the editor can run: its own commands as they are, the server's through the relay. */
function commandFor(session: LspSession): ToCommand {
  return (command: LspCommand) => {
    if (EDITOR_COMMANDS.has(command.command)) return { id: command.command, title: command.title, arguments: command.arguments }
    if (!session.commands.includes(command.command)) return undefined
    return { id: EXECUTE_COMMAND, title: command.title, arguments: [remember(session).sessionId, command.command, command.arguments ?? []] }
  }
}

/** The first server with an answer; servers that have none are skipped. */
async function firstAnswer<T>(sessions: LspSession[], ask: (session: LspSession) => Promise<T | null>, empty: (value: T) => boolean = () => false): Promise<{ session: LspSession; value: T } | null> {
  for (const session of sessions) {
    const value = await ask(session)
    if (value !== null && value !== undefined && !empty(value)) return { session, value }
  }
  return null
}

// ── Completion ───────────────────────────────────────────────────────────

const completionOrigins = new WeakMap<monaco.languages.CompletionItem, { session: LspSession; item: LspCompletionItem; defaults: LspCompletionList['itemDefaults'] }>()

function completionProvider(triggerCharacters: string[]): monaco.languages.CompletionItemProvider {
  return {
    triggerCharacters,
    async provideCompletionItems(model, position, context, token) {
      const doc = documentOf(model)
      const sessions = doc?.sessions('textDocument/completion') ?? []
      if (!doc || sessions.length === 0) return null
      const until = model.getWordUntilPosition(position)
      const whole = model.getWordAtPosition(position)
      const line = position.lineNumber
      const word = {
        insert: { startLineNumber: line, startColumn: until.startColumn, endLineNumber: line, endColumn: position.column },
        replace: { startLineNumber: line, startColumn: until.startColumn, endLineNumber: line, endColumn: whole?.endColumn ?? position.column }
      }
      const suggestions: monaco.languages.CompletionItem[] = []
      let incomplete = false
      await Promise.all(
        sessions.map(async (session) => {
          // A trigger character only one server asked for is an ordinary request to the others.
          const triggered = context.triggerCharacter !== undefined && (session.options<{ triggerCharacters: string[] }>('textDocument/completion').triggerCharacters ?? []).includes(context.triggerCharacter)
          const result = await session.request<LspCompletionList | LspCompletionItem[]>(
            'textDocument/completion',
            {
              ...at(doc, position),
              // Monaco's trigger kinds are LSP's minus one.
              context: triggered ? { triggerKind: 2, triggerCharacter: context.triggerCharacter } : { triggerKind: context.triggerKind === 2 ? 3 : 1 }
            },
            token
          )
          if (!result) return
          const list = Array.isArray(result) ? { isIncomplete: false, items: result } : result
          incomplete ||= list.isIncomplete === true
          for (const item of list.items ?? []) {
            const suggestion = toCompletionItem(item, list.itemDefaults, word, commandFor(session))
            completionOrigins.set(suggestion, { session, item, defaults: list.itemDefaults })
            suggestions.push(suggestion)
          }
        })
      )
      return { suggestions, incomplete }
    },
    async resolveCompletionItem(suggestion, token) {
      const origin = completionOrigins.get(suggestion)
      if (!origin || !origin.session.options<{ resolveProvider: boolean }>('textDocument/completion').resolveProvider) return suggestion
      const resolved = await origin.session.request<LspCompletionItem>('completionItem/resolve', withDefaultData(origin.item, origin.defaults), token)
      if (!resolved) return suggestion
      // Only what resolving may add; the edit the list showed must stay the edit that is applied.
      const full = toCompletionItem(resolved, origin.defaults, { insert: toMonacoRangeOf(suggestion), replace: toMonacoRangeOf(suggestion) }, commandFor(origin.session))
      if (full.documentation !== undefined) suggestion.documentation = full.documentation
      if (full.detail !== undefined) suggestion.detail = full.detail
      if (full.additionalTextEdits) suggestion.additionalTextEdits = full.additionalTextEdits
      if (full.command && !suggestion.command) suggestion.command = full.command
      return suggestion
    }
  }
}

function toMonacoRangeOf(suggestion: monaco.languages.CompletionItem): monaco.IRange {
  return 'insert' in suggestion.range ? suggestion.range.insert : suggestion.range
}

// ── The other providers ──────────────────────────────────────────────────

const hoverProvider: monaco.languages.HoverProvider = {
  async provideHover(model, position, token) {
    const doc = documentOf(model)
    if (!doc) return null
    const hovers = (await Promise.all(doc.sessions('textDocument/hover').map((session) => session.request<LspHover>('textDocument/hover', at(doc, position), token))))
      .filter((hover): hover is LspHover => !!hover?.contents)
      .map(toHover)
      .filter((hover) => hover.contents.length > 0)
    if (hovers.length === 0) return null
    return { contents: hovers.flatMap((hover) => hover.contents), ...(hovers[0]!.range ? { range: hovers[0]!.range } : {}) }
  }
}

function signatureHelpProvider(triggers: string[], retriggers: string[]): monaco.languages.SignatureHelpProvider {
  return {
    signatureHelpTriggerCharacters: triggers,
    signatureHelpRetriggerCharacters: retriggers,
    async provideSignatureHelp(model, position, token, context) {
      const doc = documentOf(model)
      if (!doc) return null
      const answer = await firstAnswer(
        doc.sessions('textDocument/signatureHelp'),
        (session) =>
          session.request<LspSignatureHelp>(
            'textDocument/signatureHelp',
            // Monaco's signature-help trigger kinds are LSP's.
            { ...at(doc, position), context: { triggerKind: context.triggerKind, ...(context.triggerCharacter ? { triggerCharacter: context.triggerCharacter } : {}), isRetrigger: context.isRetrigger } },
            token
          ),
        (help) => !help.signatures?.length
      )
      return answer ? { value: toSignatureHelp(answer.value), dispose: () => undefined } : null
    }
  }
}

type Locations = LspLocation | LspLocation[] | LspLocationLink[]

/** Definition and its relatives: the first server that knows, with every file it names made peekable. */
async function locate(method: string, model: Model, position: monaco.IPosition, token: Token, extra: object = {}): Promise<monaco.languages.LocationLink[] | null> {
  const doc = documentOf(model)
  if (!doc) return null
  const answer = await firstAnswer(
    doc.sessions(method),
    (session) => session.request<Locations>(method, { ...at(doc, position), ...extra }, token),
    (value) => Array.isArray(value) && value.length === 0
  )
  if (!answer) return null
  await ensureModels(answer.session, locationUris(answer.value))
  return toLocations(answer.value, monacoUri)
}

const definitionProvider: monaco.languages.DefinitionProvider = { provideDefinition: (model, position, token) => locate('textDocument/definition', model, position, token) }
const declarationProvider: monaco.languages.DeclarationProvider = { provideDeclaration: (model, position, token) => locate('textDocument/declaration', model, position, token) }
const typeDefinitionProvider: monaco.languages.TypeDefinitionProvider = { provideTypeDefinition: (model, position, token) => locate('textDocument/typeDefinition', model, position, token) }
const implementationProvider: monaco.languages.ImplementationProvider = { provideImplementation: (model, position, token) => locate('textDocument/implementation', model, position, token) }
const referenceProvider: monaco.languages.ReferenceProvider = {
  provideReferences: (model, position, context, token) => locate('textDocument/references', model, position, token, { context: { includeDeclaration: context.includeDeclaration } })
}

const highlightProvider: monaco.languages.DocumentHighlightProvider = {
  async provideDocumentHighlights(model, position, token) {
    const doc = documentOf(model)
    if (!doc) return null
    const answer = await firstAnswer(doc.sessions('textDocument/documentHighlight'), (session) => session.request<LspDocumentHighlight[]>('textDocument/documentHighlight', at(doc, position), token))
    return answer ? answer.value.map(toDocumentHighlight) : null
  }
}

const symbolProvider: monaco.languages.DocumentSymbolProvider = {
  displayName: 'Language server',
  async provideDocumentSymbols(model, token) {
    const doc = documentOf(model)
    if (!doc) return null
    const answer = await firstAnswer(doc.sessions('textDocument/documentSymbol'), (session) => session.request<(LspDocumentSymbol | LspSymbolInformation)[]>('textDocument/documentSymbol', textDocument(doc), token))
    return answer ? toDocumentSymbols(answer.value) : null
  }
}

function formattingOptions(options: monaco.languages.FormattingOptions) {
  return { tabSize: options.tabSize, insertSpaces: options.insertSpaces }
}

const formattingProvider: monaco.languages.DocumentFormattingEditProvider = {
  displayName: 'Language server',
  async provideDocumentFormattingEdits(model, options, token) {
    const doc = documentOf(model)
    if (!doc) return null
    const answer = await firstAnswer(doc.sessions('textDocument/formatting'), (session) => session.request<LspTextEdit[]>('textDocument/formatting', { ...textDocument(doc), options: formattingOptions(options) }, token))
    return answer ? answer.value.map(toTextEdit) : null
  }
}

const rangeFormattingProvider: monaco.languages.DocumentRangeFormattingEditProvider = {
  displayName: 'Language server',
  async provideDocumentRangeFormattingEdits(model, range, options, token) {
    const doc = documentOf(model)
    if (!doc) return null
    const answer = await firstAnswer(doc.sessions('textDocument/rangeFormatting'), (session) =>
      session.request<LspTextEdit[]>('textDocument/rangeFormatting', { ...textDocument(doc), range: toLspRange(range), options: formattingOptions(options) }, token)
    )
    return answer ? answer.value.map(toTextEdit) : null
  }
}

const renameProvider: monaco.languages.RenameProvider = {
  async provideRenameEdits(model, position, newName, token) {
    const doc = documentOf(model)
    const session = doc?.sessions('textDocument/rename')[0]
    if (!doc || !session) return null
    const edit = await session.request<LspWorkspaceEdit>('textDocument/rename', { ...at(doc, position), newName }, token)
    if (!edit) return { edits: [], rejectReason: t('{name} could not rename this', { name: session.name }) }
    // Applied here rather than handed to Monaco, whose own applying only reaches models that exist:
    // a rename also touches files that are not open (lsp-workspace-edit).
    await applyWorkspaceEditAndReport(session, edit, t('Rename'))
    return { edits: [] }
  },
  async resolveRenameLocation(model, position, token) {
    const doc = documentOf(model)
    const session = doc?.sessions('textDocument/rename')[0]
    const word = model.getWordAtPosition(position)
    const fallback = word
      ? { range: { startLineNumber: position.lineNumber, startColumn: word.startColumn, endLineNumber: position.lineNumber, endColumn: word.endColumn }, text: word.word }
      : { range: { startLineNumber: position.lineNumber, startColumn: position.column, endLineNumber: position.lineNumber, endColumn: position.column }, text: '', rejectReason: t('Nothing to rename here') }
    if (!doc || !session || !session.options<{ prepareProvider: boolean }>('textDocument/rename').prepareProvider) return fallback
    const prepared = await session.request<LspRange | { range: LspRange; placeholder: string } | { defaultBehavior: boolean }>('textDocument/prepareRename', at(doc, position), token)
    if (!prepared) return { ...fallback, rejectReason: t('Nothing to rename here') }
    if ('defaultBehavior' in prepared) return fallback
    const range = toMonacoRange('range' in prepared ? prepared.range : prepared)
    return { range, text: 'placeholder' in prepared ? prepared.placeholder : model.getValueInRange(range) }
  }
}

const codeActionProvider: monaco.languages.CodeActionProvider = {
  async provideCodeActions(model, range, context, token) {
    const doc = documentOf(model)
    if (!doc) return null
    const actions: monaco.languages.CodeAction[] = []
    await Promise.all(
      doc.sessions('textDocument/codeAction').map(async (session) => {
        const result = await session.request<(LspCodeAction | LspCommand)[]>(
          'textDocument/codeAction',
          {
            ...textDocument(doc),
            range: toLspRange(range),
            // The server's own diagnostics, with the data it attached, so it can find its fix.
            context: { diagnostics: diagnosticsForMarkers(context.markers, doc.diagnosticsFrom(session)), ...(context.only ? { only: [context.only] } : {}), triggerKind: context.trigger }
          },
          token
        )
        for (const entry of result ?? []) {
          const action: LspCodeAction = 'command' in entry && typeof entry.command === 'string' ? { title: entry.title, command: entry as LspCommand } : (entry as LspCodeAction)
          actions.push({
            title: action.title,
            ...(action.kind ? { kind: action.kind } : {}),
            ...(action.isPreferred ? { isPreferred: true } : {}),
            ...(action.disabled ? { disabled: action.disabled.reason } : {}),
            diagnostics: context.markers.filter((marker) => diagnosticsForMarkers([marker], action.diagnostics ?? []).length > 0),
            command: { id: APPLY_CODE_ACTION, title: action.title, arguments: [remember(session).sessionId, action] }
          })
        }
      })
    )
    return { actions, dispose: () => undefined }
  }
}

/** A chosen code action: its edit (fetched now if the server left it for later), then its command. */
async function applyCodeAction(sessionId: string, action: LspCodeAction): Promise<void> {
  const session = sessionsById.get(sessionId)
  if (!session) return
  let chosen = action
  if (!chosen.edit && !chosen.command && session.options<{ resolveProvider: boolean }>('textDocument/codeAction').resolveProvider) {
    chosen = (await session.request<LspCodeAction>('codeAction/resolve', action)) ?? action
  }
  if (chosen.edit && !(await applyWorkspaceEditAndReport(session, chosen.edit, chosen.title))) return
  if (chosen.command) await executeCommand(sessionId, chosen.command.command, chosen.command.arguments ?? [])
}

async function executeCommand(sessionId: string, command: string, args: unknown[]): Promise<void> {
  const session = sessionsById.get(sessionId)
  if (!session || !session.commands.includes(command)) return
  // Any edit the command makes comes back as `workspace/applyEdit`.
  await session.request('workspace/executeCommand', { command, arguments: args })
}

// ── Registration ─────────────────────────────────────────────────────────

interface Registered {
  /** Providers whose trigger characters are fixed at registration, and what they were registered with. */
  triggered: monaco.IDisposable[]
  signature: string
}

const registered = new Map<string, Registered>()
let globalsRegistered = false

function registerGlobals(): void {
  if (globalsRegistered) return
  globalsRegistered = true
  monaco.editor.registerCommand(EXECUTE_COMMAND, (_accessor, sessionId: string, command: string, args: unknown[]) => void executeCommand(sessionId, command, args))
  monaco.editor.registerCommand(APPLY_CODE_ACTION, (_accessor, sessionId: string, action: LspCodeAction) => void applyCodeAction(sessionId, action))
  // Going to a location in another file: a workspace file opens in a tab at that line.
  monaco.editor.registerEditorOpener({
    openCodeEditor(source, resource, selectionOrPosition) {
      const uri = resource.toString()
      // Asked first for every jump, also within the file being shown: that one the editor does itself.
      if (source.getModel()?.uri.toString() === uri) return false
      const file = parseLspDocumentUri(uri)
      if (!file) {
        if (isExternalUri(uri)) toast.info(t('That is outside the workspace'), { description: t('{path} cannot be opened in a tab. Peek shows it in place.', { path: externalPath(uri) }) })
        return false
      }
      const line = !selectionOrPosition ? undefined : 'lineNumber' in selectionOrPosition ? selectionOrPosition.lineNumber : selectionOrPosition.startLineNumber
      openEditorTab({ workspaceId: file.workspaceId, kind: 'file', path: file.path, staged: false, ...(line ? { line } : {}) })
      return true
    }
  })
}

function unique(values: string[]): string[] {
  return [...new Set(values)].sort()
}

/** Makes sure an editor language has its providers, with the trigger characters its servers ask for now. */
function ensureProviders(languageId: string, sessions: LspSession[]): void {
  registerGlobals()
  const completion = unique(sessions.flatMap((s) => s.options<{ triggerCharacters: string[] }>('textDocument/completion').triggerCharacters ?? []))
  const signature = unique(sessions.flatMap((s) => s.options<{ triggerCharacters: string[] }>('textDocument/signatureHelp').triggerCharacters ?? []))
  const retrigger = unique(sessions.flatMap((s) => s.options<{ retriggerCharacters: string[] }>('textDocument/signatureHelp').retriggerCharacters ?? []))
  const key = JSON.stringify([completion, signature, retrigger])
  const existing = registered.get(languageId)
  if (existing?.signature === key) return
  if (!existing) {
    monaco.languages.registerHoverProvider(languageId, hoverProvider)
    monaco.languages.registerDefinitionProvider(languageId, definitionProvider)
    monaco.languages.registerDeclarationProvider(languageId, declarationProvider)
    monaco.languages.registerTypeDefinitionProvider(languageId, typeDefinitionProvider)
    monaco.languages.registerImplementationProvider(languageId, implementationProvider)
    monaco.languages.registerReferenceProvider(languageId, referenceProvider)
    monaco.languages.registerDocumentHighlightProvider(languageId, highlightProvider)
    monaco.languages.registerDocumentSymbolProvider(languageId, symbolProvider)
    monaco.languages.registerDocumentFormattingEditProvider(languageId, formattingProvider)
    monaco.languages.registerDocumentRangeFormattingEditProvider(languageId, rangeFormattingProvider)
    monaco.languages.registerRenameProvider(languageId, renameProvider)
    monaco.languages.registerCodeActionProvider(languageId, codeActionProvider)
  }
  for (const disposable of existing?.triggered ?? []) disposable.dispose()
  registered.set(languageId, {
    signature: key,
    triggered: [
      monaco.languages.registerCompletionItemProvider(languageId, completionProvider(completion)),
      monaco.languages.registerSignatureHelpProvider(languageId, signatureHelpProvider(signature, retrigger))
    ]
  })
}

/**
 * Follows which editor languages have a server behind an open document: those get providers, and
 * Monaco's own in-browser language service for them is turned off so there is one source of
 * completions and problems; it comes back when the last such document or server goes.
 */
function syncLanguages(): void {
  const byLanguage = new Map<string, LspSession[]>()
  for (const doc of allDocuments()) {
    const language = doc.model.getLanguageId()
    byLanguage.set(language, [...(byLanguage.get(language) ?? []), ...doc.allSessions])
  }
  for (const [language, sessions] of byLanguage) {
    if (sessions.length > 0) ensureProviders(language, [...new Set(sessions)])
  }
  for (const language of new Set([...byLanguage.keys(), ...served])) {
    const now = (byLanguage.get(language) ?? []).some((session) => session.role === 'primary' && !session.ended)
    if (now === served.has(language)) continue
    if (now) served.add(language)
    else served.delete(language)
    setLanguageServed(language, now)
  }
}

const served = new Set<string>()

onLanguagesChanged(syncLanguages)
