import { createExternalStore } from './external-store'

// Orca's diff line comments ("review notes", shared/diff-comment-types.ts): notes left on the
// modified side of a diff, handed to an agent as one prompt. Kept per workspace in this window.

export interface ReviewNote {
  id: string
  workspaceId: string
  filePath: string
  /** Inclusive range start, when the note covers several lines. */
  startLine?: number
  lineNumber: number
  body: string
  createdAt: number
  updatedAt?: number
  /** Set once handed to an agent; editing clears it. */
  sentAt?: number
  /** The diff the note was written on, to reopen it there. */
  staged: boolean
  compare?: { base: string; head: string; label: string }
}

const KEY = 'acp-harness.review-notes.v1'

function readSaved(): Record<string, ReviewNote[]> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}')
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, ReviewNote[]>) : {}
  } catch {
    return {}
  }
}

const store = createExternalStore<Record<string, ReviewNote[]>>(readSaved(), (state) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(state))
  } catch {
    // Notes last for this session when storage is unavailable.
  }
})

const EMPTY: ReviewNote[] = []

export function useReviewNotes(workspaceId: string): ReviewNote[] {
  return store.use((s) => s[workspaceId] ?? EMPTY)
}

export function getReviewNotes(workspaceId: string): ReviewNote[] {
  return store.get()[workspaceId] ?? EMPTY
}

function updateWorkspace(workspaceId: string, change: (notes: ReviewNote[]) => ReviewNote[]): void {
  store.update((s) => {
    const next = change(s[workspaceId] ?? EMPTY)
    const { [workspaceId]: _old, ...rest } = s
    return next.length > 0 ? { ...rest, [workspaceId]: next } : rest
  })
}

export function addReviewNote(note: Omit<ReviewNote, 'id' | 'createdAt'>): ReviewNote {
  const created = { ...note, id: crypto.randomUUID(), createdAt: Date.now() }
  updateWorkspace(note.workspaceId, (notes) => [...notes, created])
  return created
}

export function editReviewNote(workspaceId: string, id: string, body: string): void {
  updateWorkspace(workspaceId, (notes) =>
    notes.map((n) => (n.id === id ? { ...n, body, updatedAt: Date.now(), sentAt: undefined } : n))
  )
}

export function deleteReviewNote(workspaceId: string, id: string): void {
  updateWorkspace(workspaceId, (notes) => notes.filter((n) => n.id !== id))
}

/** Drops every note, or one file's. */
export function clearReviewNotes(workspaceId: string, filePath?: string): void {
  updateWorkspace(workspaceId, (notes) => (filePath ? notes.filter((n) => n.filePath !== filePath) : []))
}

export function markReviewNotesSent(workspaceId: string, ids: string[]): void {
  const sent = new Set(ids)
  const at = Date.now()
  updateWorkspace(workspaceId, (notes) => notes.map((n) => (sent.has(n.id) ? { ...n, sentAt: at } : n)))
}

/** Orca's formatDiffComment: the pasted format is the contract with whichever agent reads it. */
export function formatReviewNote(note: ReviewNote): string {
  const escaped = note.body.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r/g, '\\r').replace(/\n/g, '\\n')
  const location =
    note.lineNumber === 0
      ? 'Scope: file'
      : note.startLine !== undefined && note.startLine !== note.lineNumber
        ? `Lines: ${note.startLine}-${note.lineNumber}`
        : `Line: ${note.lineNumber}`
  return [`File: ${note.filePath}`, location, `User comment: "${escaped}"`].join('\n')
}

export function formatReviewNotes(notes: readonly ReviewNote[]): string {
  return notes.map(formatReviewNote).join('\n\n')
}
