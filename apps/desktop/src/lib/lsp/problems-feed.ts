import { parseLspDocumentUri } from '@acp-harness/protocol'
import { monaco } from '@/lib/monaco-setup'
import { setProblemFiles, type Problem, type ProblemFile, type ProblemSeverity } from './problems-store'

// Mirrors Monaco's markers into the problems store. Every marker on a workspace file counts, whoever
// set it, so anything that marks a model shows up in the Problems panel without knowing about it.

function severityOf(severity: monaco.MarkerSeverity): ProblemSeverity | null {
  if (severity === monaco.MarkerSeverity.Error) return 'error'
  if (severity === monaco.MarkerSeverity.Warning) return 'warning'
  if (severity === monaco.MarkerSeverity.Info) return 'info'
  // Hints are editor decoration (faded unused code), not problems.
  return null
}

function collect(): void {
  const byFile = new Map<string, ProblemFile>()
  for (const marker of monaco.editor.getModelMarkers({})) {
    const severity = severityOf(marker.severity)
    const file = severity ? parseLspDocumentUri(marker.resource.toString()) : null
    if (!severity || !file) continue
    const key = `${file.workspaceId}\0${file.path}`
    const entry = byFile.get(key) ?? { ...file, problems: [] }
    byFile.set(key, entry)
    const problem: Problem = {
      severity,
      message: marker.message,
      source: marker.source ?? null,
      code: marker.code === undefined ? null : typeof marker.code === 'string' ? marker.code : marker.code.value,
      line: marker.startLineNumber,
      column: marker.startColumn
    }
    entry.problems.push(problem)
  }
  setProblemFiles([...byFile.values()])
}

let queued = false
monaco.editor.onDidChangeMarkers(() => {
  // Servers report file after file in a burst; one pass covers them.
  if (queued) return
  queued = true
  setTimeout(() => {
    queued = false
    collect()
  }, 50)
})
collect()
