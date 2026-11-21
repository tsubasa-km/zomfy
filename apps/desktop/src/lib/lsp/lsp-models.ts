import { HARNESS_METHODS, LSP_DOCUMENT_ROOT, LSP_EXTERNAL_ROOT, lspDocumentUri, parseLspDocumentUri } from '@zomfy/protocol'
import { harnessRequest } from '@/daemon-connection'
import { monaco } from '@/lib/monaco-setup'
import { LSP_CLIENT_ID, type LspSession } from './lsp-client'

// How the editor's models and the URIs on the wire map onto each other, and how files that are not
// open get a model when the editor needs to show them (a peek at a definition, a list of references).

type Model = monaco.editor.ITextModel

/** The editor's URI for a URI off the wire. Workspace files get the exact spelling the text editor uses for its models. */
export function monacoUri(wire: string): monaco.Uri {
  const doc = parseLspDocumentUri(wire)
  return monaco.Uri.parse(doc ? `${LSP_DOCUMENT_ROOT}/${doc.workspaceId}/${doc.path}` : wire)
}

/** The wire URI of a workspace file. */
export function wireUri(workspaceId: string, path: string): string {
  return lspDocumentUri(workspaceId, path)
}

/** The workspace file an editor model shows; null for models that are not workspace files. */
export function workspaceFileOf(model: Model): { workspaceId: string; path: string } | null {
  return parseLspDocumentUri(model.uri.toString())
}

export function isExternalUri(uri: string): boolean {
  return uri.startsWith(`${LSP_EXTERNAL_ROOT}/`)
}

/** The host path of a file outside the workspace, for telling the person where it is. */
export function externalPath(uri: string): string {
  const rest = uri.slice(LSP_EXTERNAL_ROOT.length + 1)
  try {
    return decodeURIComponent(rest.slice(rest.indexOf('/') + 1))
  } catch {
    return rest
  }
}

/** How many files one request may load to show its results; the rest show without a preview. */
const MAX_PRELOAD = 30
/** Files outside the workspace have no tab whose closing would drop their model, so only the latest stay. */
const MAX_EXTERNAL_MODELS = 20
const externalModels: Model[] = []

/**
 * Gives every file a result names a model, reading the ones that are not open from the host. The
 * editor can only peek into files it has a model for. Workspace files loaded this way are dropped
 * with the other tab-less models when a text editor closes.
 */
export async function ensureModels(session: LspSession, uris: string[]): Promise<void> {
  const missing = uris.filter((uri) => !monaco.editor.getModel(monacoUri(uri))).slice(0, MAX_PRELOAD)
  await Promise.all(
    missing.map(async (uri) => {
      try {
        const doc = parseLspDocumentUri(uri)
        if (doc) {
          const file = await harnessRequest(HARNESS_METHODS.fsRead, { workspaceId: doc.workspaceId, path: doc.path }, session.hostId)
          if (file.binary || file.truncated) return
          if (!monaco.editor.getModel(monacoUri(uri))) monaco.editor.createModel(file.content, undefined, monacoUri(uri))
        } else if (isExternalUri(uri)) {
          const file = await harnessRequest(HARNESS_METHODS.lspReadExternal, { clientId: LSP_CLIENT_ID, sessionId: session.sessionId, uri }, session.hostId)
          if (monaco.editor.getModel(monacoUri(uri))) return
          externalModels.push(monaco.editor.createModel(file.content, undefined, monacoUri(uri)))
          while (externalModels.length > MAX_EXTERNAL_MODELS) externalModels.shift()?.dispose()
        }
      } catch {
        // Unreadable (deleted since, too large): the result still lists it, without a preview.
      }
    })
  )
}
