import { useRef, useState } from 'react'
import { Check, ChevronDown, Copy, MessageSquare, MoreHorizontal, Trash, Trash2 } from 'lucide-react'
import { openEditorTab } from '@/session-store'
import {
  clearReviewNotes,
  deleteReviewNote,
  formatReviewNote,
  formatReviewNotes,
  getReviewNotes,
  markReviewNotesSent,
  useReviewNotes,
  type ReviewNote
} from '@/stores/review-notes-store'
import { SendToAgentMenu } from '@/components/SendToAgentMenu'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

// Orca's source-control notes shelf (notes-shelf.tsx, diff-comments-list.tsx): every review note in
// the workspace, grouped by file, with send / copy / clear.

const ICON_BUTTON =
  'inline-flex size-6 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground'

function lineLabel(note: ReviewNote): string {
  return note.startLine !== undefined && note.startLine !== note.lineNumber ? `L${note.startLine}-${note.lineNumber}` : `L${note.lineNumber}`
}

function openNote(note: ReviewNote): void {
  openEditorTab({
    workspaceId: note.workspaceId,
    kind: 'diff',
    path: note.filePath,
    staged: note.staged,
    line: note.lineNumber,
    ...(note.compare ? { compare: note.compare } : {})
  })
}

export function ReviewNotesShelf({ workspaceId }: { workspaceId: string }) {
  const notes = useReviewNotes(workspaceId)
  const [expanded, setExpanded] = useState(true)
  const [copied, setCopied] = useState<string | null>(null)
  const handedOver = useRef<string[]>([])
  if (notes.length === 0) return null

  const copy = (key: string, text: string) =>
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(key)
      window.setTimeout(() => setCopied((c) => (c === key ? null : c)), 1200)
    })
  const byFile = new Map<string, ReviewNote[]>()
  for (const note of [...notes].sort((a, b) => a.filePath.localeCompare(b.filePath) || a.lineNumber - b.lineNumber)) {
    byFile.set(note.filePath, [...(byFile.get(note.filePath) ?? []), note])
  }
  const unsent = notes.filter((n) => !n.sentAt)

  return (
    <div className="border-b border-border" data-review-notes-shelf>
      <div className="flex items-center gap-1 py-1.5 pr-2 pl-3">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-xs text-muted-foreground transition-colors hover:text-foreground"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          title={expanded ? 'Collapse notes' : 'Expand notes'}
        >
          <ChevronDown className={cn('size-3 shrink-0 transition-transform', !expanded && '-rotate-90')} />
          <MessageSquare className="size-3.5 shrink-0" />
          <span>Notes</span>
          <span className="text-[11px] leading-none text-muted-foreground tabular-nums">{notes.length}</span>
        </button>
        <SendToAgentMenu
          workspaceId={workspaceId}
          count={unsent.length}
          buildPrompt={() => {
            const pending = getReviewNotes(workspaceId).filter((n) => !n.sentAt)
            handedOver.current = pending.map((n) => n.id)
            return pending.length > 0 ? formatReviewNotes(pending) : null
          }}
          onSent={() => markReviewNotesSent(workspaceId, handedOver.current)}
        />
        <button type="button" className={ICON_BUTTON} aria-label="Copy all notes to clipboard" title="Copy all notes" onClick={() => copy('all', formatReviewNotes(notes))}>
          {copied === 'all' ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" className={ICON_BUTTON} aria-label="More note actions">
              <MoreHorizontal className="size-3.5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-[180px]">
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onSelect={() => {
                if (window.confirm(`Clear all ${notes.length} notes in this workspace?`)) clearReviewNotes(workspaceId)
              }}
            >
              <Trash2 className="size-3.5" />
              Clear all notes...
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {expanded && (
        <div className="bg-muted/20">
          {[...byFile].map(([filePath, fileNotes]) => (
            <div key={filePath} className="px-3 py-1.5">
              <div className="group/file flex items-center gap-1">
                <button
                  type="button"
                  className="block min-w-0 flex-1 truncate text-left text-[10px] font-medium text-muted-foreground hover:text-foreground"
                  title={filePath}
                  onClick={() => openNote(fileNotes[0]!)}
                >
                  {filePath}
                </button>
                <button
                  type="button"
                  className="shrink-0 rounded p-0.5 text-muted-foreground opacity-0 transition-opacity group-hover/file:opacity-100 hover:text-destructive"
                  title="Clear notes in this file"
                  aria-label={`Clear notes in ${filePath}`}
                  onClick={() => clearReviewNotes(workspaceId, filePath)}
                >
                  <Trash2 className="size-3" />
                </button>
              </div>
              <ul className="mt-1 space-y-1">
                {fileNotes.map((note) => (
                  <li key={note.id} className="group flex items-center gap-1.5 rounded px-1 py-0.5 hover:bg-accent/40" data-review-note-row>
                    <button type="button" className="flex min-w-0 flex-1 items-center gap-1.5 text-left" title="Open in diff" onClick={() => openNote(note)}>
                      <span className="shrink-0 rounded bg-muted px-1 py-0.5 text-[10px] leading-none text-muted-foreground tabular-nums">{lineLabel(note)}</span>
                      {note.sentAt && <span className="shrink-0 rounded bg-muted/70 px-1 py-0.5 text-[10px] leading-none text-muted-foreground">Sent</span>}
                      <span className="block min-w-0 flex-1 text-[11px] leading-snug break-words whitespace-pre-wrap text-foreground">{note.body}</span>
                    </button>
                    <button
                      type="button"
                      className="shrink-0 rounded p-0.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:text-foreground"
                      title="Copy note"
                      aria-label="Copy note"
                      onClick={() => copy(note.id, formatReviewNote(note))}
                    >
                      {copied === note.id ? <Check className="size-3" /> : <Copy className="size-3" />}
                    </button>
                    <button
                      type="button"
                      className="shrink-0 rounded p-0.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:text-destructive"
                      title="Delete note"
                      aria-label="Delete note"
                      onClick={() => deleteReviewNote(workspaceId, note.id)}
                    >
                      <Trash className="size-3" />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
