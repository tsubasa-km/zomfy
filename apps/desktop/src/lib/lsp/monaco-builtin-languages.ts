import * as monaco from 'monaco-editor'
import {
  CodeActionAdaptor,
  DefinitionAdapter,
  DocumentHighlightAdapter,
  FormatAdapter,
  FormatOnTypeAdapter,
  InlayHintsAdapter,
  LibFiles,
  OutlineAdapter,
  QuickInfoAdapter,
  ReferenceAdapter,
  RenameAdapter,
  SignatureHelpAdapter,
  SuggestAdapter
} from 'monaco-editor/esm/vs/language/typescript/languageFeatures.js'

// Monaco's own in-browser language services (TypeScript/JavaScript, JSON), switched per language.
// They know only the open models: no tsconfig, no node_modules. That is better than nothing for a
// file no language server serves, and wrong beside one, where the person would see two sets of
// completions and two opinions on what is an error. setLanguageServed turns a language's built-in
// service off while a server serves it and back on afterwards.
//
// Monaco's TypeScript mode registers its providers once, when the first such file opens, and
// cannot take them back. So that mode is told to register none, and the same worker-backed
// providers are registered here instead, where they can be disposed.

type TsDefaults = typeof monaco.typescript.typescriptDefaults

const TS_MODE_PROVIDERS_OFF = {
  completionItems: false,
  hovers: false,
  documentSymbols: false,
  definitions: false,
  references: false,
  documentHighlights: false,
  rename: false,
  documentRangeFormattingEdits: false,
  signatureHelp: false,
  onTypeFormattingEdits: false,
  codeActions: false,
  inlayHints: false,
  // The mode keeps its diagnostics; those are switched through the diagnostics options.
  diagnostics: true
}

interface TsLanguage {
  defaults: TsDefaults
  getWorker: () => Promise<(...uris: monaco.Uri[]) => Promise<unknown>>
  diagnostics: ReturnType<TsDefaults['getDiagnosticsOptions']>
  providers: monaco.IDisposable[]
}

const tsLanguages = new Map<string, TsLanguage>()

/** The mode's worker exists once the first file of the language has loaded it; a provider called just before waits. */
function workerOf(language: TsLanguage) {
  return async (...uris: monaco.Uri[]): Promise<unknown> => {
    for (let attempt = 0; ; attempt++) {
      let get: (...uris: monaco.Uri[]) => Promise<unknown>
      try {
        get = await language.getWorker()
      } catch (error) {
        if (attempt >= 50) throw error
        await new Promise((resolve) => setTimeout(resolve, 100))
        continue
      }
      return get(...uris)
    }
  }
}

function registerTsProviders(languageId: string, language: TsLanguage): void {
  const worker = workerOf(language)
  const libFiles = new LibFiles(worker)
  language.providers = [
    monaco.languages.registerCompletionItemProvider(languageId, new SuggestAdapter(worker)),
    monaco.languages.registerSignatureHelpProvider(languageId, new SignatureHelpAdapter(worker)),
    monaco.languages.registerHoverProvider(languageId, new QuickInfoAdapter(worker)),
    monaco.languages.registerDocumentHighlightProvider(languageId, new DocumentHighlightAdapter(worker)),
    monaco.languages.registerDefinitionProvider(languageId, new DefinitionAdapter(libFiles, worker)),
    monaco.languages.registerReferenceProvider(languageId, new ReferenceAdapter(libFiles, worker)),
    monaco.languages.registerDocumentSymbolProvider(languageId, new OutlineAdapter(worker)),
    monaco.languages.registerRenameProvider(languageId, new RenameAdapter(libFiles, worker)),
    monaco.languages.registerDocumentRangeFormattingEditProvider(languageId, new FormatAdapter(worker)),
    monaco.languages.registerOnTypeFormattingEditProvider(languageId, new FormatOnTypeAdapter(worker)),
    monaco.languages.registerCodeActionProvider(languageId, new CodeActionAdaptor(worker)),
    monaco.languages.registerInlayHintsProvider(languageId, new InlayHintsAdapter(worker))
  ]
}

function setupTsLanguage(languageId: string, defaults: TsDefaults, getWorker: TsLanguage['getWorker']): void {
  const language: TsLanguage = { defaults, getWorker, diagnostics: defaults.getDiagnosticsOptions(), providers: [] }
  tsLanguages.set(languageId, language)
  defaults.setModeConfiguration(TS_MODE_PROVIDERS_OFF)
  registerTsProviders(languageId, language)
}

setupTsLanguage('typescript', monaco.typescript.typescriptDefaults, monaco.typescript.getTypeScriptWorker)
setupTsLanguage('javascript', monaco.typescript.javascriptDefaults, monaco.typescript.getJavaScriptWorker)

const jsonMode = monaco.json.jsonDefaults.modeConfiguration
const jsonDiagnostics = monaco.json.jsonDefaults.diagnosticsOptions

/**
 * Turns Monaco's built-in service for an editor language off (a language server serves it) or back
 * on. Languages Monaco has no service for are ignored.
 */
export function setLanguageServed(languageId: string, served: boolean): void {
  const ts = tsLanguages.get(languageId)
  if (ts) {
    for (const provider of ts.providers.splice(0)) provider.dispose()
    if (!served) registerTsProviders(languageId, ts)
    // The mode re-checks every open model when these change, which also clears what it had reported.
    ts.defaults.setDiagnosticsOptions(served ? { ...ts.diagnostics, noSemanticValidation: true, noSyntaxValidation: true, noSuggestionDiagnostics: true } : ts.diagnostics)
  } else if (languageId === 'json') {
    monaco.json.jsonDefaults.setModeConfiguration(
      served ? { ...jsonMode, documentFormattingEdits: false, documentRangeFormattingEdits: false, completionItems: false, hovers: false, documentSymbols: false, diagnostics: false } : jsonMode
    )
    monaco.json.jsonDefaults.setDiagnosticsOptions(served ? { ...jsonDiagnostics, validate: false } : jsonDiagnostics)
  }
}
