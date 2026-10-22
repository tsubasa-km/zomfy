import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { DiffOnMount } from '@monaco-editor/react'
import { CornerDownLeft, Pencil, Trash } from 'lucide-react'
import { monaco } from '@/lib/monaco-setup'
import { addReviewNote, deleteReviewNote, editReviewNote, useReviewNotes, type ReviewNote } from '@/stores/review-notes-store'
import { Button } from '@/components/ui/button'
import './review-notes.css'

// Orca's useDiffCommentDecorator + DiffCommentCard/DiffCommentDraftCard: a "+" on the hovered line
// of the modified side opens a draft note in a view zone; saved notes stay inline under their line.

type DiffEditorInstance = Parameters<DiffOnMount>[0]
type CodeEditor = monaco.editor.ICodeEditor

const PLUS_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="M12 5v14"/></svg>'

interface Draft {
  startLine: number
  line: number
}

function rangeLabel(start: number | undefined, line: number): string {
  return start !== undefined && start !== line ? `Lines ${start}-${line}` : `Line ${line}`
}

/** The hovered-line "+" button, placed in the gutter like Orca's diff-comment-add-button-overlay. */
function useAddNoteButton(editor: CodeEditor, onAdd: (draft: Draft) => void): void {
  const onAddRef = useRef(onAdd)
  onAddRef.current = onAdd
  useEffect(() => {
    const dom = editor.getDomNode()
    if (!dom) return
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'review-note-add-btn'
    button.title = 'Add note for the AI'
    button.setAttribute('aria-label', 'Add note for the AI')
    button.dataset.reviewNoteAdd = ''
    button.innerHTML = PLUS_SVG
    dom.appendChild(button)
    let line = 0
    let hideTimer: number | undefined
    const place = () => {
      if (!line) {
        button.style.display = 'none'
        return
      }
      const lineHeight = editor.getOption(monaco.editor.EditorOption.lineHeight)
      button.style.top = `${editor.getTopForLineNumber(line) - editor.getScrollTop() + (lineHeight - 18) / 2}px`
      button.style.display = 'flex'
    }
    const subscriptions = [
      editor.onMouseMove((e) => {
        window.clearTimeout(hideTimer)
        const next = e.target.position?.lineNumber ?? 0
        if (next !== line) {
          line = next
          place()
        }
      }),
      editor.onMouseLeave(() => {
        // Moving onto the button itself leaves the editor's view; keep it for that.
        hideTimer = window.setTimeout(() => {
          if (!button.matches(':hover')) {
            line = 0
            place()
          }
        }, 150)
      }),
      editor.onDidScrollChange(place)
    ]
    button.addEventListener('mousedown', (e) => {
      e.preventDefault()
      e.stopPropagation()
    })
    button.addEventListener('click', (e) => {
      e.stopPropagation()
      if (!line) return
      // A selection that covers the hovered line becomes the note's range (Orca's range notes).
      const selection = editor.getSelection()
      if (selection && !selection.isEmpty() && selection.startLineNumber <= line && line <= selection.endLineNumber) {
        const end = selection.endColumn === 1 && selection.endLineNumber > selection.startLineNumber ? selection.endLineNumber - 1 : selection.endLineNumber
        onAddRef.current({ startLine: selection.startLineNumber, line: end })
      } else {
        onAddRef.current({ startLine: line, line })
      }
    })
    button.addEventListener('mouseleave', () => {
      line = 0
      place()
    })
    return () => {
      window.clearTimeout(hideTimer)
      subscriptions.forEach((s) => s.dispose())
      button.remove()
    }
  }, [editor])
}

export function DiffReviewNotes({
  diffEditor,
  workspaceId,
  path,
  staged,
  compare
}: {
  diffEditor: DiffEditorInstance
  workspaceId: string
  path: string
  staged: boolean
  compare?: ReviewNote['compare']
}) {
  const editor = diffEditor.getModifiedEditor()
  const all = useReviewNotes(workspaceId)
  const notes = useMemo(() => all.filter((n) => n.filePath === path), [all, path])
  const [draft, setDraft] = useState<Draft | null>(null)
  const [zoneEls, setZoneEls] = useState<Map<string, HTMLElement>>(new Map())
  const zones = useRef(new Map<string, { id: string; zone: monaco.editor.IViewZone }>())
  const heights = useRef(new Map<string, number>())

  useAddNoteButton(editor, setDraft)

  const zoneKey = notes.map((n) => `${n.id}@${n.lineNumber}`).join(',') + (draft ? `|draft@${draft.line}` : '')
  useEffect(() => {
    const entries = [...notes.map((n) => ({ key: n.id, after: n.lineNumber })), ...(draft ? [{ key: 'draft', after: draft.line }] : [])]
    const created = new Map<string, { id: string; zone: monaco.editor.IViewZone }>()
    const els = new Map<string, HTMLElement>()
    editor.changeViewZones((accessor) => {
      for (const entry of entries) {
        const el = document.createElement('div')
        el.className = 'review-note-zone'
        // Monaco's keybindings listen on the editor root; keep typing in a note out of them.
        for (const type of ['keydown', 'keypress', 'keyup'] as const) el.addEventListener(type, (e) => e.stopPropagation())
        const zone: monaco.editor.IViewZone = { afterLineNumber: entry.after, heightInPx: heights.current.get(entry.key) ?? 96, domNode: el }
        created.set(entry.key, { id: accessor.addZone(zone), zone })
        els.set(entry.key, el)
      }
    })
    zones.current = created
    setZoneEls(els)
    return () => {
      editor.changeViewZones((accessor) => created.forEach(({ id }) => accessor.removeZone(id)))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- zoneKey captures notes/draft placement
  }, [editor, zoneKey])

  const onHeight = useCallback(
    (key: string, height: number) => {
      const padded = Math.ceil(height) + 10
      heights.current.set(key, padded)
      const entry = zones.current.get(key)
      if (!entry || entry.zone.heightInPx === padded) return
      entry.zone.heightInPx = padded
      editor.changeViewZones((accessor) => accessor.layoutZone(entry.id))
    },
    [editor]
  )

  useEffect(() => {
    const decorations = editor.createDecorationsCollection(
      [...notes, ...(draft ? [{ startLine: draft.startLine, lineNumber: draft.line }] : [])].map((n) => ({
        range: new monaco.Range(n.startLine ?? n.lineNumber, 1, n.lineNumber, 1),
        options: { isWholeLine: true, className: 'review-note-range-highlight', linesDecorationsClassName: 'review-note-range-margin' }
      }))
    )
    return () => decorations.clear()
  }, [editor, notes, draft])

  return (
    <>
      {notes.map((note) => {
        const el = zoneEls.get(note.id)
        return el ? createPortal(<NoteCard note={note} onHeight={(h) => onHeight(note.id, h)} />, el, note.id) : null
      })}
      {draft &&
        zoneEls.get('draft') &&
        createPortal(
          <DraftCard
            label={rangeLabel(draft.startLine, draft.line)}
            onHeight={(h) => onHeight('draft', h)}
            onCancel={() => setDraft(null)}
            onSubmit={(body) => {
              addReviewNote({
                workspaceId,
                filePath: path,
                lineNumber: draft.line,
                ...(draft.startLine !== draft.line ? { startLine: draft.startLine } : {}),
                body,
                staged,
                ...(compare ? { compare } : {})
              })
              setDraft(null)
            }}
          />,
          zoneEls.get('draft')!,
          'draft'
        )}
    </>
  )
}

function useMeasured(onHeight: (height: number) => void) {
  const ref = useRef<HTMLDivElement>(null)
  const onHeightRef = useRef(onHeight)
  onHeightRef.current = onHeight
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    onHeightRef.current(el.offsetHeight)
    const observer = new ResizeObserver(() => onHeightRef.current(el.offsetHeight))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  return ref
}

function NoteTextarea({
  initial,
  submitLabel,
  onCancel,
  onSubmit
}: {
  initial: string
  submitLabel: string
  onCancel: () => void
  onSubmit: (body: string) => void
}) {
  const [body, setBody] = useState(initial)
  const submit = () => body.trim() && onSubmit(body.trim())
  return (
    <>
      <textarea
        autoFocus
        className="review-note-textarea"
        placeholder="Add note for the AI"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDownCapture={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault()
            onCancel()
          } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault()
            submit()
          }
        }}
        data-review-note-input
      />
      <div className="flex items-center justify-end gap-1.5">
        <Button type="button" size="xs" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="button" size="xs" disabled={!body.trim()} onClick={submit} data-review-note-submit>
          {submitLabel}
          <CornerDownLeft className="ml-1 size-3 opacity-70" />
        </Button>
      </div>
    </>
  )
}

function DraftCard({
  label,
  onHeight,
  onCancel,
  onSubmit
}: {
  label: string
  onHeight: (height: number) => void
  onCancel: () => void
  onSubmit: (body: string) => void
}) {
  const ref = useMeasured(onHeight)
  return (
    <div ref={ref} className="review-note-card" data-review-note-draft>
      <div className="review-note-header">{label}</div>
      <NoteTextarea initial="" submitLabel="Add note" onCancel={onCancel} onSubmit={onSubmit} />
    </div>
  )
}

function NoteCard({ note, onHeight }: { note: ReviewNote; onHeight: (height: number) => void }) {
  const ref = useMeasured(onHeight)
  const [editing, setEditing] = useState(false)
  return (
    <div ref={ref} className="review-note-card" data-review-note={note.id}>
      <div className="review-note-header">
        <span className="flex items-center gap-1.5">
          {rangeLabel(note.startLine, note.lineNumber)}
          {note.sentAt && <span className="rounded bg-muted px-1 text-[10px] font-normal text-muted-foreground">Sent</span>}
        </span>
        {!editing && (
          <span className="review-note-pill">
            <button type="button" className="review-note-pill-btn" title="Edit note" aria-label="Edit note" onClick={() => setEditing(true)}>
              <Pencil className="size-3" />
            </button>
            <button
              type="button"
              className="review-note-pill-btn review-note-pill-btn-danger"
              title="Delete note"
              aria-label="Delete note"
              onClick={() => deleteReviewNote(note.workspaceId, note.id)}
            >
              <Trash className="size-3" />
            </button>
          </span>
        )}
      </div>
      {editing ? (
        <NoteTextarea
          initial={note.body}
          submitLabel="Save"
          onCancel={() => setEditing(false)}
          onSubmit={(body) => {
            editReviewNote(note.workspaceId, note.id, body)
            setEditing(false)
          }}
        />
      ) : (
        <div className="review-note-body">{note.body}</div>
      )}
    </div>
  )
}
