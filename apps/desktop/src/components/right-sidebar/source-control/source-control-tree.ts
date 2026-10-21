import type { GitChange } from '@acp-harness/protocol'

// Orca's source-control-tree.ts: path tree per section, single-child folder chains compacted
// (as VS Code does), flattened against the collapsed set for rendering.

export type ChangeTreeFile = { type: 'file'; key: string; entry: GitChange; depth: number }
export type ChangeTreeDirectory = {
  type: 'directory'
  key: string
  name: string
  path: string
  depth: number
  fileCount: number
  children: ChangeTreeNode[]
}
export type ChangeTreeNode = ChangeTreeFile | ChangeTreeDirectory

type MutableDir = ChangeTreeDirectory & { dirs: Map<string, MutableDir> }

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

export function buildChangeTree(section: string, entries: GitChange[]): ChangeTreeNode[] {
  const root: MutableDir = { type: 'directory', key: '', name: '', path: '', depth: -1, fileCount: 0, children: [], dirs: new Map() }
  for (const entry of entries) {
    const segments = entry.path.split('/').filter(Boolean)
    if (segments.length === 0) continue
    let parent = root
    let ancestor = ''
    for (let i = 0; i < segments.length - 1; i++) {
      const name = segments[i]!
      ancestor = ancestor ? `${ancestor}/${name}` : name
      let dir = parent.dirs.get(name)
      if (!dir) {
        dir = { type: 'directory', key: `dir::${section}::${ancestor}`, name, path: ancestor, depth: i, fileCount: 0, children: [], dirs: new Map() }
        parent.dirs.set(name, dir)
        parent.children.push(dir)
      }
      parent = dir
    }
    parent.children.push({ type: 'file', key: `${section}::${entry.path}`, entry, depth: segments.length - 1 })
  }
  return finalize(root).children.map((node) => compact(node, 0))
}

function finalize(node: ChangeTreeDirectory): ChangeTreeDirectory {
  const dirs = node.children.filter((c): c is ChangeTreeDirectory => c.type === 'directory').map(finalize)
  const files = node.children.filter((c): c is ChangeTreeFile => c.type === 'file')
  dirs.sort((a, b) => collator.compare(a.name, b.name))
  files.sort((a, b) => collator.compare(a.entry.path, b.entry.path))
  const fileCount = files.length + dirs.reduce((n, d) => n + d.fileCount, 0)
  return { type: 'directory', key: node.key, name: node.name, path: node.path, depth: node.depth, fileCount, children: [...dirs, ...files] }
}

function compact(node: ChangeTreeNode, depth: number): ChangeTreeNode {
  if (node.type === 'file') return { ...node, depth }
  const names = [node.name]
  let current = node
  while (current.children.length === 1 && current.children[0]!.type === 'directory') {
    current = current.children[0]
    names.push(current.name)
  }
  return { ...current, name: names.join('/'), depth, children: current.children.map((child) => compact(child, depth + 1)) }
}

export function flattenChangeTree(nodes: readonly ChangeTreeNode[], collapsed: ReadonlySet<string>): ChangeTreeNode[] {
  const out: ChangeTreeNode[] = []
  const visit = (node: ChangeTreeNode) => {
    out.push(node)
    if (node.type === 'directory' && !collapsed.has(node.key)) node.children.forEach(visit)
  }
  nodes.forEach(visit)
  return out
}

export function directoryFiles(node: ChangeTreeDirectory): GitChange[] {
  return node.children.flatMap((child) => (child.type === 'file' ? [child.entry] : directoryFiles(child)))
}
