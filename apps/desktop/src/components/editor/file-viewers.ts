import type { ComponentType } from 'react'
import type { EditorTab } from '@/session-store'

// What opens a file instead of the text editor. A viewer claims files by path and draws the whole
// tab; the first registered that claims a path wins. Built-in ones are registered in
// editor-builtins; anything else that wants a kind of file (a plugin, later) registers here too.

export interface FileViewer {
  id: string
  /** Whether this viewer opens the file at `path` (workspace-relative, '/'-separated). */
  match: (path: string) => boolean
  Component: ComponentType<{ tab: EditorTab }>
}

const viewers: FileViewer[] = []

/** Adds a viewer, replacing one registered under the same id (a hot reload registers again). */
export function registerFileViewer(viewer: FileViewer): void {
  const at = viewers.findIndex((v) => v.id === viewer.id)
  if (at === -1) viewers.push(viewer)
  else viewers[at] = viewer
}

export function fileViewerFor(path: string): FileViewer | null {
  return viewers.find((v) => v.match(path)) ?? null
}
