import type { FileEntry } from '@acp-harness/protocol'
import { parentDir } from './explorer-paths'

// Orca's useFileExplorerKeys + file-explorer-keyboard-navigation (VS Code's tree keys): arrows walk
// the visible rows, Left/Right collapse/expand or step to parent/child, Space opens, Enter or F2
// renames, Delete (⌘⌫ on Mac) deletes, Shift+Alt+C / ⌥⌘C copy paths.

const isMac = navigator.userAgent.includes('Mac')

export function useExplorerKeys(opts: {
  entries: FileEntry[]
  expanded: Set<string>
  disabled: boolean
  treeRef: React.RefObject<HTMLDivElement | null>
  select: (path: string) => void
  selectRange: (path: string) => void
  clearSelection: () => void
  expand: (dir: string) => void
  collapse: (dir: string) => void
  activate: (entry: FileEntry) => void
  rename: (entry: FileEntry) => void
  remove: (entry: FileEntry) => void
  copyPaths: (entry: FileEntry, kind: 'absolute' | 'relative') => void
}): (event: React.KeyboardEvent) => void {
  return (event) => {
    if (opts.disabled || !(event.target instanceof HTMLElement) || !event.target.dataset.path) return
    const { entries } = opts
    const index = entries.findIndex((e) => e.path === (event.target as HTMLElement).dataset.path)
    const current = entries[index]
    if (!current) return

    const moveTo = (target: number) => {
      const entry = entries[Math.max(0, Math.min(entries.length - 1, target))]
      if (!entry) return
      event.preventDefault()
      if (event.shiftKey) opts.selectRange(entry.path)
      else opts.select(entry.path)
      opts.treeRef.current?.querySelector<HTMLElement>(`[data-path="${CSS.escape(entry.path)}"]`)?.focus()
    }
    const plain = !event.metaKey && !event.ctrlKey && !event.altKey
    const page = Math.max(1, Math.floor(entries.length / 10))
    if (plain) {
      switch (event.key) {
        case 'ArrowDown':
          return moveTo(index + 1)
        case 'ArrowUp':
          return moveTo(index - 1)
        case 'Home':
          return moveTo(0)
        case 'End':
          return moveTo(entries.length - 1)
        case 'PageDown':
          return moveTo(index + page)
        case 'PageUp':
          return moveTo(index - page)
        case 'ArrowRight':
          if (current.kind !== 'dir') return
          event.preventDefault()
          if (!opts.expanded.has(current.path)) opts.expand(current.path)
          else if (entries[index + 1] && parentDir(entries[index + 1]!.path) === current.path) moveTo(index + 1)
          return
        case 'ArrowLeft':
          event.preventDefault()
          if (current.kind === 'dir' && opts.expanded.has(current.path)) opts.collapse(current.path)
          else if (parentDir(current.path)) moveTo(entries.findIndex((e) => e.path === parentDir(current.path)))
          return
        case 'Escape':
          opts.clearSelection()
          return
      }
      if (!event.shiftKey) {
        if (event.key === ' ') {
          event.preventDefault()
          return opts.activate(current)
        }
        if (event.key === 'Enter' || event.key === 'F2') {
          event.preventDefault()
          return opts.rename(current)
        }
        if (!isMac && event.key === 'Delete') {
          event.preventDefault()
          return opts.remove(current)
        }
      }
    }
    if (isMac && event.metaKey && event.key === 'Backspace') {
      event.preventDefault()
      return opts.remove(current)
    }
    if (event.code === 'KeyC' && event.altKey) {
      const relative = isMac ? event.metaKey && event.shiftKey : event.ctrlKey && event.shiftKey
      const absolute = isMac ? event.metaKey && !event.shiftKey : event.shiftKey && !event.ctrlKey
      if (!relative && !absolute) return
      event.preventDefault()
      opts.copyPaths(current, relative ? 'relative' : 'absolute')
    }
  }
}
