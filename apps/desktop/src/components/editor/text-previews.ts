import type { ComponentType } from 'react'
import { updateEditorPreferences, useEditorPreferences, type MarkdownViewMode } from './editor-preferences'

// A rendered view of a text file beside or instead of its source: Markdown as a page, a CSV as a
// table. The text editor asks here by path, shows the toggle between source, both and preview, and
// hands the preview the text as it is typed. Built-in ones are registered in editor-builtins.

export type PreviewMode = MarkdownViewMode
export const PREVIEW_MODES: readonly PreviewMode[] = ['source', 'split', 'preview']

export interface TextPreviewProps {
  /** The editor's current text, unsaved edits included. */
  content: string
  workspaceId: string
  path: string
  /** Puts the source's cursor on a line (1-based) and scrolls it into view; a no-op while only the preview shows. */
  revealLine: (line: number, column?: number) => void
}

export interface TextPreview {
  id: string
  /** Whether the file at `path` (workspace-relative, '/'-separated) has this preview. */
  match: (path: string) => boolean
  /** How such a file opens until the person picks another mode. */
  defaultMode: PreviewMode
  Component: ComponentType<TextPreviewProps>
}

const previews: TextPreview[] = []

/** Adds a preview, replacing one registered under the same id (a hot reload registers again). */
export function registerTextPreview(preview: TextPreview): void {
  const at = previews.findIndex((p) => p.id === preview.id)
  if (at === -1) previews.push(preview)
  else previews[at] = preview
}

export function textPreviewFor(path: string): TextPreview | null {
  return previews.find((p) => p.match(path)) ?? null
}

/** The mode files with this preview show in, remembered per kind of preview. */
export function usePreviewMode(preview: TextPreview | null): [PreviewMode, (mode: PreviewMode) => void] {
  const prefs = useEditorPreferences()
  if (!preview) return ['source', () => undefined]
  // Markdown's mode predates the registry and keeps its own preference.
  if (preview.id === 'markdown') return [prefs.markdownViewMode, (mode) => updateEditorPreferences({ markdownViewMode: mode })]
  return [
    prefs.previewModes?.[preview.id] ?? preview.defaultMode,
    (mode) => updateEditorPreferences({ previewModes: { ...prefs.previewModes, [preview.id]: mode } })
  ]
}
