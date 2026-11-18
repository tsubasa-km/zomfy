import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { createExternalStore } from '@/stores/external-store'

// The part of the status bar that describes the file being edited (cursor position, encoding, line
// endings, language), as VS Code has it on the right of its bar. The bar keeps one slot; of the
// editors on screen, the one last worked in draws its items into it.

interface EditorStatusState {
  /** The status bar's element for the items; null while the bar is hidden. */
  slot: HTMLElement | null
  /** The editors on screen, the one last worked in first. */
  owners: readonly string[]
}

const store = createExternalStore<EditorStatusState>({ slot: null, owners: [] })

/** Puts `owner` first: it mounted, or took the focus. */
export function claimEditorStatus(owner: string): void {
  store.update((state) => (state.owners[0] === owner ? state : { ...state, owners: [owner, ...state.owners.filter((o) => o !== owner)] }))
}

function releaseEditorStatus(owner: string): void {
  store.update((state) => ({ ...state, owners: state.owners.filter((o) => o !== owner) }))
}

/** The status bar's side of it: where the current editor's items go. */
export function EditorStatusSlot() {
  return (
    <div
      data-editor-status
      className="flex items-center gap-1 empty:hidden"
      ref={(slot) => {
        store.update((state) => (state.slot === slot ? state : { ...state, slot }))
      }}
    />
  )
}

/**
 * An editor's side: its items, shown in the status bar while it is the editor last worked in, and
 * in place (the editor's own header) when the status bar is hidden.
 */
export function EditorStatusItems({ owner, children }: { owner: string; children: ReactNode }) {
  useEffect(() => {
    claimEditorStatus(owner)
    return () => releaseEditorStatus(owner)
  }, [owner])
  const slot = store.use((state) => state.slot)
  const current = store.use((state) => state.owners[0] === owner)
  if (!slot) return <>{children}</>
  return current ? createPortal(children, slot) : null
}

/** A status bar item's look, for the buttons editors put there. */
export const editorStatusButtonClass =
  'flex-shrink-0 rounded px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:hover:bg-transparent disabled:hover:text-muted-foreground'
