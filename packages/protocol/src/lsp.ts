// Language servers run on the host where a workspace's files are; the window's editor reaches them
// through the daemon. The daemon starts and supervises each server, speaks LSP to it over stdio and
// relays messages both ways, translating document URIs at that boundary: the window only ever sees
// `file:///__harness/<workspaceId>/<path>` (its editor models), the server real `file://` paths.

/** A window's editor URI for a workspace file. */
export const LSP_DOCUMENT_ROOT = 'file:///__harness'
/** A file outside the workspace that a server pointed at (a library's sources): readable, not editable. */
export const LSP_EXTERNAL_ROOT = 'file:///__harness-external'

/** `path` is workspace-relative and '/'-separated. */
export function lspDocumentUri(workspaceId: string, path: string): string {
  return `${LSP_DOCUMENT_ROOT}/${workspaceId}/${path.split('/').map(encodeLspUriSegment).join('/')}`
}

/** The workspace file a window URI names; null for anything else (external files included). */
export function parseLspDocumentUri(uri: string): { workspaceId: string; path: string } | null {
  const prefix = `${LSP_DOCUMENT_ROOT}/`
  if (!uri.startsWith(prefix)) return null
  const rest = uri.slice(prefix.length).replace(/[?#].*$/, '')
  const slash = rest.indexOf('/')
  if (slash <= 0) return null
  try {
    return { workspaceId: rest.slice(0, slash), path: rest.slice(slash + 1).split('/').map(decodeURIComponent).join('/') }
  } catch {
    return null
  }
}

/** Percent-encodes as VS Code does, so servers see the spelling they are tested against. */
export function encodeLspUriSegment(segment: string): string {
  return encodeURIComponent(segment).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
}

/** `primary` servers answer completion, navigation and the like; a `linter` only adds diagnostics and fixes beside one. */
export type LspServerRole = 'primary' | 'linter'

/** One running server a document is attached to. */
export interface LspSessionInfo {
  sessionId: string
  serverId: string
  /** Shown beside its diagnostics ("rust-analyzer"). */
  name: string
  role: LspServerRole
  /** Bumped each time the server process is started again; documents are then opened anew. */
  generation: number
  /** The server's `initialize` capabilities, as it sent them. */
  capabilities: Record<string, unknown>
  /** Capabilities the server registered after starting (`client/registerCapability`). */
  registrations: LspRegistration[]
}

export interface LspRegistration {
  id: string
  method: string
  registerOptions?: unknown
}

/** A server that would serve the language, and what would put it on the host. */
export interface LspServerHint {
  serverId: string
  name: string
  /** The command that was looked for ("rust-analyzer"). */
  command: string
  /** A command or short instruction that installs it; never run by Zomfy. */
  install: string
}

export interface LspOpenParams {
  clientId: string
  workspaceId: string
  /** Workspace-relative, '/'-separated. */
  path: string
  /** The editor's own language id, for languages the host knows no file extension of. */
  languageId: string
}

export interface LspOpenResult {
  /** The LSP language id to open the document under ("typescriptreact"). */
  languageId: string
  sessions: LspSessionInfo[]
  /** Servers that serve the language but could not be started, and why. */
  failed: { serverId: string; name: string; message: string }[]
  /** Set when nothing serves the language's main features and a known server would. */
  missing: LspServerHint[]
}

export type LspSessionState = 'ready' | 'restarting' | 'stopped' | 'failed'

/** Everything the daemon tells a window about its language servers, as one notification so order holds. */
export type LspEvent = { clientId: string } & (
  | { kind: 'notification'; sessionId: string; method: string; params: unknown }
  /** A server→client request only the window can answer (`workspace/applyEdit`); answered with `lspRespond`. */
  | { kind: 'request'; sessionId: string; id: number; method: string; params: unknown }
  | {
      kind: 'state'
      sessionId: string
      state: LspSessionState
      generation: number
      /** With `ready`. */
      capabilities?: Record<string, unknown>
      /** With `failed` and `stopped`. */
      message?: string
    }
  | { kind: 'registrations'; sessionId: string; registrations: LspRegistration[] }
  /** The host's server commands changed; documents ask again which servers serve them. */
  | { kind: 'servers-changed' }
)

export interface LspError {
  code: number
  message: string
}

/** A known or user-added server on a host, for settings. */
export interface LspServerStatus {
  id: string
  name: string
  role: LspServerRole
  /** LSP language ids (or editor language ids, for added servers). */
  languages: string[]
  builtin: boolean
  /** The person's command line; null uses the built-in lookup. */
  command: string | null
  disabled: boolean
  /** What would be started, or null when nothing was found. */
  resolved: string | null
  /** Why nothing was found, or what the command that was found said. */
  detail: string | null
  install: string | null
}

export interface LspSetServerParams {
  id: string
  /** null or empty goes back to the built-in lookup. */
  command?: string | null
  /** Only for added servers. */
  languages?: string[]
  disabled?: boolean
  /** Deletes an added server, or a built-in one's overrides. */
  remove?: boolean
  /** Looks under this workspace's `node_modules/.bin` too when reporting what was found. */
  workspaceId?: string
}

export const LSP_METHODS = {
  lspOpen: '_harness/lsp/open',
  lspRequest: '_harness/lsp/request',
  lspNotify: '_harness/lsp/notify',
  lspCancel: '_harness/lsp/cancel',
  lspRespond: '_harness/lsp/respond',
  lspKeepAlive: '_harness/lsp/keepAlive',
  lspReadExternal: '_harness/lsp/readExternal',
  lspServers: '_harness/lsp/servers',
  lspSetServer: '_harness/lsp/setServer'
} as const

export const LSP_NOTIFICATIONS = {
  lspEvent: '_harness/lsp/event'
} as const

export interface LspRequests {
  /** Which servers serve a file, starting them if this is the first of its language in the workspace. */
  [LSP_METHODS.lspOpen]: { params: LspOpenParams; result: LspOpenResult }
  /**
   * One LSP request to a session's server. `seq` counts a session's requests and notifications from 0
   * in the order the window sent them; the daemon delivers them in that order.
   */
  [LSP_METHODS.lspRequest]: {
    params: { clientId: string; sessionId: string; seq: number; requestId: string; method: string; params: unknown }
    result: { result: unknown } | { error: LspError }
  }
  [LSP_METHODS.lspNotify]: {
    params: { clientId: string; sessionId: string; seq: number; method: string; params: unknown }
    result: Record<string, never>
  }
  /** Gives up on a request still being answered (`$/cancelRequest`). */
  [LSP_METHODS.lspCancel]: { params: { clientId: string; sessionId: string; requestId: string }; result: Record<string, never> }
  /** The window's answer to an `LspEvent` of kind `request`. */
  [LSP_METHODS.lspRespond]: {
    params: { clientId: string; sessionId: string; id: number; result?: unknown; error?: LspError }
    result: Record<string, never>
  }
  /** A window that stops calling is taken for closed, and its servers stop. */
  [LSP_METHODS.lspKeepAlive]: { params: { clientId: string }; result: Record<string, never> }
  /** The text of a file outside the workspace that this session's server named. */
  [LSP_METHODS.lspReadExternal]: {
    params: { clientId: string; sessionId: string; uri: string }
    result: { content: string; path: string }
  }
  [LSP_METHODS.lspServers]: { params: { workspaceId?: string }; result: LspServerStatus[] }
  [LSP_METHODS.lspSetServer]: { params: LspSetServerParams; result: LspServerStatus[] }
}

/**
 * What the window's editor can do, sent to every server at `initialize`. Positions are UTF-16, as
 * the editor counts columns. Watched files are not offered, so servers watch the disk themselves.
 */
export const LSP_CLIENT_CAPABILITIES = {
  general: { positionEncodings: ['utf-16'], markdown: { parser: 'marked' } },
  window: { workDoneProgress: true, showMessage: {}, showDocument: { support: false } },
  workspace: {
    applyEdit: true,
    configuration: true,
    workspaceFolders: true,
    workspaceEdit: {
      documentChanges: true,
      resourceOperations: ['create', 'rename', 'delete'],
      failureHandling: 'abort'
    },
    executeCommand: { dynamicRegistration: true },
    didChangeConfiguration: { dynamicRegistration: true },
    didChangeWatchedFiles: { dynamicRegistration: false }
  },
  textDocument: {
    synchronization: { dynamicRegistration: true, didSave: true, willSave: false, willSaveWaitUntil: false },
    publishDiagnostics: {
      relatedInformation: true,
      versionSupport: true,
      codeDescriptionSupport: true,
      dataSupport: true,
      tagSupport: { valueSet: [1, 2] }
    },
    completion: {
      dynamicRegistration: true,
      contextSupport: true,
      insertTextMode: 2,
      completionItem: {
        snippetSupport: true,
        commitCharactersSupport: true,
        documentationFormat: ['markdown', 'plaintext'],
        deprecatedSupport: true,
        preselectSupport: true,
        tagSupport: { valueSet: [1] },
        insertReplaceSupport: true,
        labelDetailsSupport: true,
        insertTextModeSupport: { valueSet: [1, 2] },
        resolveSupport: { properties: ['documentation', 'detail', 'additionalTextEdits'] }
      },
      completionItemKind: { valueSet: Array.from({ length: 25 }, (_, i) => i + 1) },
      completionList: { itemDefaults: ['commitCharacters', 'editRange', 'insertTextFormat', 'insertTextMode', 'data'] }
    },
    hover: { dynamicRegistration: true, contentFormat: ['markdown', 'plaintext'] },
    signatureHelp: {
      dynamicRegistration: true,
      contextSupport: true,
      signatureInformation: {
        documentationFormat: ['markdown', 'plaintext'],
        parameterInformation: { labelOffsetSupport: true },
        activeParameterSupport: true
      }
    },
    declaration: { dynamicRegistration: true, linkSupport: true },
    definition: { dynamicRegistration: true, linkSupport: true },
    typeDefinition: { dynamicRegistration: true, linkSupport: true },
    implementation: { dynamicRegistration: true, linkSupport: true },
    references: { dynamicRegistration: true },
    documentHighlight: { dynamicRegistration: true },
    documentSymbol: {
      dynamicRegistration: true,
      hierarchicalDocumentSymbolSupport: true,
      symbolKind: { valueSet: Array.from({ length: 26 }, (_, i) => i + 1) },
      tagSupport: { valueSet: [1] }
    },
    codeAction: {
      dynamicRegistration: true,
      isPreferredSupport: true,
      disabledSupport: true,
      dataSupport: true,
      resolveSupport: { properties: ['edit'] },
      codeActionLiteralSupport: {
        codeActionKind: {
          valueSet: ['', 'quickfix', 'refactor', 'refactor.extract', 'refactor.inline', 'refactor.rewrite', 'source', 'source.organizeImports', 'source.fixAll']
        }
      }
    },
    formatting: { dynamicRegistration: true },
    rangeFormatting: { dynamicRegistration: true },
    rename: { dynamicRegistration: true, prepareSupport: true, prepareSupportDefaultBehavior: 1 }
  }
} as const
