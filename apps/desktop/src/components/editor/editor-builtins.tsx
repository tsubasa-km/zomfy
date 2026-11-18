import { BinaryFileView } from './BinaryFileView'
import { MarkdownPreview } from './MarkdownPreview'
import { getEditorFileKind } from './editor-file-kind'
import { registerFileViewer } from './file-viewers'
import { registerTextPreview } from './text-previews'

// The viewers and previews the app ships with. Imported once for its registrations.

registerFileViewer({
  id: 'image',
  match: (path) => getEditorFileKind(path) === 'image',
  Component: ({ tab }) => <BinaryFileView tab={tab} kind="image" />
})

registerFileViewer({
  id: 'pdf',
  match: (path) => getEditorFileKind(path) === 'pdf',
  Component: ({ tab }) => <BinaryFileView tab={tab} kind="pdf" />
})

registerTextPreview({
  id: 'markdown',
  match: (path) => getEditorFileKind(path) === 'markdown',
  defaultMode: 'preview',
  Component: ({ content, workspaceId, path }) => <MarkdownPreview content={content} workspaceId={workspaceId} filePath={path} />
})
