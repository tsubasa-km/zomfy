import type { SizeSplit } from '@zomfy/protocol'
import { t } from '@/i18n/i18n'

// A worktree's size as the sidebar and the cleanup dialog show it: what it holds of its own (what
// deleting it frees), with the hardlinked packages it shares with bun's cache mentioned apart.

export function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(bytes > 0 ? 1 : 0, Math.round(bytes / 1024))} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

export function sizeLabel(size: SizeSplit): string {
  const shared = size.bytes - size.ownBytes
  if (shared < 1024 * 1024) return formatBytes(size.ownBytes)
  return t('{own} (plus {shared} shared)', { own: formatBytes(size.ownBytes), shared: formatBytes(shared) })
}
