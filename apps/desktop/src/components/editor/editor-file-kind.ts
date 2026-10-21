/** Which surface a file opens in, decided by extension as Orca's editor-panel-content-types does. */
export type EditorFileKind = 'image' | 'pdf' | 'markdown' | 'text'

const IMAGE_MIME_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  webp: 'image/webp',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  avif: 'image/avif'
}

const MARKDOWN_EXTENSIONS = new Set(['md', 'markdown', 'mdx', 'mdown', 'mkd'])

export function fileExtension(path: string): string {
  const name = path.split('/').pop() ?? path
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
}

export function getEditorFileKind(path: string): EditorFileKind {
  const ext = fileExtension(path)
  if (ext in IMAGE_MIME_TYPES) return 'image'
  if (ext === 'pdf') return 'pdf'
  if (MARKDOWN_EXTENSIONS.has(ext)) return 'markdown'
  return 'text'
}

export function imageMimeType(path: string): string | null {
  return IMAGE_MIME_TYPES[fileExtension(path)] ?? null
}

export function formatByteSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
