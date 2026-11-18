import type { EditorTab } from '@/session-store'
import { fileViewerFor } from '@/components/editor/file-viewers'
import { TextFileEditor } from '@/components/editor/TextFileEditor'
import '@/components/editor/editor-builtins'

/**
 * A file's tab: the viewer registered for that kind of file (an image, a PDF…), or the text editor,
 * which is what a file gets when nothing else claims it.
 */
export function FileEditorView({ tab }: { tab: EditorTab }) {
  const viewer = fileViewerFor(tab.path)
  return viewer ? <viewer.Component tab={tab} /> : <TextFileEditor tab={tab} />
}
