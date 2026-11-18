import { toast } from 'sonner'
import { HARNESS_METHODS, parseLspDocumentUri } from '@acp-harness/protocol'
import { harnessRequest } from '@/daemon-connection'
import { monaco } from '@/lib/monaco-setup'
import { getState, moveEditorTabs, setEditorDirty } from '@/session-store'
import { t } from '@/i18n/i18n'
import type { LspSession } from './lsp-client'
import { applyTextEdits, toMonacoRange, workspaceEditSteps } from './lsp-convert'
import { setWorkspaceEditApplier } from './lsp-documents'
import { monacoUri } from './lsp-models'
import type { LspTextEdit, LspWorkspaceEdit } from './lsp-types'

// Carries out an edit a server computed across files (a rename, a quick fix, `workspace/applyEdit`).
//
// A file open in a tab is edited in its editor model: the change shows as unsaved and can be undone
// there. A file that is not open is rewritten on its host and saved at once, as VS Code does by
// default for refactorings (`files.refactoring.autoSave`): opening a tab per touched file would
// bury the editor under a rename, and an edit left only in memory would be lost with no tab to save
// it from. The write is refused if the file changed on disk since it was read, and those files are
// counted in a notice, since they have no undo.

export interface WorkspaceEditOutcome {
  applied: boolean
  /** Files changed in an open editor. */
  inEditors: number
  /** Files changed and saved on the host, with no tab open. */
  onDisk: number
  failureReason?: string
}

function fileTabs(workspaceId: string, path: string) {
  return getState().editorTabs.filter((tab) => tab.kind === 'file' && tab.workspaceId === workspaceId && tab.path === path)
}

function editModel(model: monaco.editor.ITextModel, edits: LspTextEdit[]): void {
  const operations = edits.map((edit) => ({ range: toMonacoRange(edit.range), text: edit.newText, forceMoveMarkers: true }))
  const editor = monaco.editor.getEditors().find((candidate) => candidate.getModel() === model)
  if (editor && !editor.getOption(monaco.editor.EditorOption.readOnly)) {
    // Through the editor where there is one, so the cursor follows and undo takes it back in one step.
    editor.pushUndoStop()
    editor.executeEdits('lsp', operations)
    editor.pushUndoStop()
    return
  }
  model.pushStackElement()
  model.pushEditOperations([], operations, () => null)
  model.pushStackElement()
}

/** Applies a server's workspace edit; stops at the first step that fails (earlier steps stay, as announced to servers). */
export async function applyWorkspaceEdit(session: LspSession, edit: LspWorkspaceEdit): Promise<WorkspaceEditOutcome> {
  const outcome: WorkspaceEditOutcome = { applied: true, inEditors: 0, onDisk: 0 }
  const fail = (reason: string): WorkspaceEditOutcome => ({ ...outcome, applied: false, failureReason: reason })
  const { hostId } = session
  for (const step of workspaceEditSteps(edit)) {
    const uri = step.kind === 'rename' ? step.oldUri : step.uri
    const file = parseLspDocumentUri(uri)
    if (!file) return fail(t('{file} is outside the workspace and was left alone', { file: uri }))
    const { workspaceId, path } = file
    try {
      if (step.kind === 'edit') {
        if (step.edits.length === 0) continue
        const model = monaco.editor.getModel(monacoUri(uri))
        const tabs = fileTabs(workspaceId, path)
        if (model && tabs.length > 0) {
          editModel(model, step.edits)
          // A tab that is not showing has no editor to notice the change; without the mark, coming
          // back to it would reload the file over the edit.
          for (const tab of tabs) setEditorDirty(tab.id, true)
          outcome.inEditors++
          continue
        }
        const current = await harnessRequest(HARNESS_METHODS.fsRead, { workspaceId, path }, hostId)
        if (current.binary || current.truncated) return fail(t('{file} is too large or not text, so it was left alone', { file: path }))
        const next = applyTextEdits(current.content, step.edits)
        await harnessRequest(HARNESS_METHODS.fsWrite, { workspaceId, path, content: next, expectedMtimeMs: current.mtimeMs }, hostId)
        // A model with no tab (loaded for a peek) would otherwise keep showing the old text.
        if (model) model.setValue(next)
        outcome.onDisk++
      } else if (step.kind === 'create') {
        try {
          await harnessRequest(HARNESS_METHODS.fsCreate, { workspaceId, path, kind: 'file' }, hostId)
        } catch (error) {
          if (step.options?.overwrite) await harnessRequest(HARNESS_METHODS.fsWrite, { workspaceId, path, content: '' }, hostId)
          else if (!step.options?.ignoreIfExists) throw error
        }
        outcome.onDisk++
      } else if (step.kind === 'rename') {
        const to = parseLspDocumentUri(step.newUri)
        if (!to || to.workspaceId !== workspaceId) return fail(t('{file} is outside the workspace and was left alone', { file: step.newUri }))
        await harnessRequest(HARNESS_METHODS.fsRename, { workspaceId, from: path, to: to.path }, hostId)
        moveEditorTabs(workspaceId, path, to.path)
        outcome.onDisk++
      } else {
        // To the host's trash only: a server's edit never deletes for good.
        const result = await harnessRequest(HARNESS_METHODS.fsDelete, { workspaceId, paths: [path] }, hostId)
        if (result.status === 'trash-unavailable') return fail(t('{file} could not be moved to the trash, so it was not deleted', { file: path }))
        outcome.onDisk++
      }
    } catch (error) {
      return fail(`${path}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  return outcome
}

/** Applies an edit and tells the person what it could not do, or what it saved without asking. */
export async function applyWorkspaceEditAndReport(session: LspSession, edit: LspWorkspaceEdit, label?: string): Promise<boolean> {
  const outcome = await applyWorkspaceEdit(session, edit)
  if (!outcome.applied) {
    toast.error(label ? t('{action} was not fully applied', { action: label }) : t('The edit was not fully applied'), { description: outcome.failureReason })
  } else if (outcome.onDisk > 0) {
    toast.message(
      t(outcome.onDisk === 1 ? '{n} file that was not open was changed and saved' : '{n} files that were not open were changed and saved', { n: outcome.onDisk }),
      { description: t('Undo covers only the files open in the editor.') }
    )
  }
  return outcome.applied
}

setWorkspaceEditApplier(applyWorkspaceEditAndReport)
