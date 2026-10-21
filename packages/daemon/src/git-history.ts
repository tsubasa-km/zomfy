import type { GitCommitChanges, GitHistoryItem, GitHistoryItemRef, GitHistoryResult } from '@acp-harness/protocol'
import { assertRevisions, changesBetween } from './git-changes.ts'
import { git } from './git-cli.ts'

// The workspace branch's commit log for the graph, after Orca's shared/git-history.ts. Only HEAD's
// history is walked (bounded by -n); upstream and base stay comparison metadata.

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200
/** git's well-known empty tree, the parent a root commit is diffed against. */
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'
// %D (not %(decorate:…), which is Git 2.43+) with --decorate=full gives full ref names, comma-separated.
const COMMIT_FORMAT = '%H%n%aN%n%aE%n%at%n%P%n%D%n%B'

export async function gitHistory(cwd: string, options: { limit?: number; baseRef?: string | null } = {}): Promise<GitHistoryResult> {
  const limit = Math.min(MAX_LIMIT, Math.max(1, Math.trunc(options.limit ?? DEFAULT_LIMIT)))
  const headOid = await resolveCommit(cwd, 'HEAD')
  if (!headOid) return { items: [], hasIncomingChanges: false, hasOutgoingChanges: false, hasMore: false, limit }

  const branchName = await git(cwd, ['symbolic-ref', '--quiet', '--short', 'HEAD'], { quiet: true }).catch(() => '')
  const currentRef: GitHistoryItemRef = branchName
    ? { id: `refs/heads/${branchName}`, name: branchName, revision: headOid, category: 'branches' }
    : { id: headOid, name: headOid.slice(0, 7), revision: headOid, category: 'commits' }
  const [remoteRef, rawBaseRef] = await Promise.all([upstreamRef(cwd, branchName), namedRef(cwd, options.baseRef)])
  const baseRef = rawBaseRef && rawBaseRef.id !== remoteRef?.id && rawBaseRef.id !== currentRef.id ? rawBaseRef : undefined

  let mergeBase: string | undefined
  if (remoteRef?.revision && remoteRef.revision !== headOid) {
    mergeBase = (await git(cwd, ['merge-base', headOid, remoteRef.revision], { quiet: true }).catch(() => '')) || undefined
  }

  const stdout = await git(cwd, ['log', '--no-color', `--format=${COMMIT_FORMAT}`, '-z', '--topo-order', '--decorate=full', `-n${limit + 1}`, headOid, '--'])
  const parsed = parseLog(stdout)
  return {
    items: parsed.slice(0, limit),
    currentRef,
    remoteRef,
    baseRef,
    mergeBase,
    hasIncomingChanges: Boolean(remoteRef?.revision && mergeBase) && remoteRef?.revision !== mergeBase,
    hasOutgoingChanges: Boolean(remoteRef?.revision && mergeBase) && headOid !== mergeBase,
    hasMore: parsed.length > limit,
    limit
  }
}

export async function gitCommitChanges(cwd: string, commit: string): Promise<GitCommitChanges> {
  assertRevisions([commit])
  const oid = await resolveCommit(cwd, commit)
  if (!oid) throw new Error(`Commit ${commit} was not found`)
  const parent = (await resolveCommit(cwd, `${oid}^1`)) ?? EMPTY_TREE
  return { commit: oid, parent, entries: await changesBetween(cwd, parent, oid) }
}

async function resolveCommit(cwd: string, ref: string): Promise<string | null> {
  if (!ref || ref.startsWith('-')) return null
  const out = await git(cwd, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], { quiet: true }).catch(() => '')
  return out.trim() || null
}

async function upstreamRef(cwd: string, branchName: string): Promise<GitHistoryItemRef | undefined> {
  if (!branchName) return undefined
  const out = await git(cwd, ['for-each-ref', '--format=%(upstream)%00%(upstream:short)', `refs/heads/${branchName}`], { quiet: true }).catch(() => '')
  const [fullName, shortName] = out.split('\0').map((s) => s.trim())
  if (!fullName || !shortName) return undefined
  const oid = await resolveCommit(cwd, fullName)
  return oid ? refFromFullName(fullName, shortName, oid) : undefined
}

async function namedRef(cwd: string, ref: string | null | undefined): Promise<GitHistoryItemRef | undefined> {
  const name = ref?.trim()
  if (!name || name.startsWith('-')) return undefined
  const [oid, fullName] = await Promise.all([
    resolveCommit(cwd, name),
    git(cwd, ['rev-parse', '--symbolic-full-name', name], { quiet: true }).catch(() => '')
  ])
  return oid ? refFromFullName(fullName.split(/\r?\n/)[0]?.trim() || null, name, oid) : undefined
}

function refFromFullName(fullName: string | null, fallbackName: string, revision: string): GitHistoryItemRef {
  const id = fullName || fallbackName
  if (id.startsWith('refs/heads/')) return { id, name: id.slice(11), revision, category: 'branches' }
  if (id.startsWith('refs/remotes/')) return { id, name: id.slice(13), revision, category: 'remote branches' }
  if (id.startsWith('refs/tags/')) return { id, name: id.slice(10), revision, category: 'tags' }
  return { id, name: fallbackName || revision.slice(0, 7), revision, category: 'commits' }
}

function parseLog(stdout: string): GitHistoryItem[] {
  const items: GitHistoryItem[] = []
  for (const rawRecord of stdout.split('\0')) {
    const record = rawRecord.replace(/^\n+/, '')
    if (!record.trim()) continue
    const lines: string[] = []
    let messageStart = 0
    for (let field = 0; field < 6; field++) {
      const newline = record.indexOf('\n', messageStart)
      if (newline === -1) {
        lines.push(record.slice(messageStart))
        messageStart = record.length
        break
      }
      lines.push(record.slice(messageStart, newline))
      messageStart = newline + 1
    }
    const hash = lines[0]?.trim() ?? ''
    if (!/^[0-9a-fA-F]{40,64}$/.test(hash)) continue
    const seconds = Number.parseInt(lines[3] ?? '', 10)
    const parents = (lines[4] ?? '').trim()
    const message = record.slice(messageStart).replace(/\n+$/, '')
    items.push({
      id: hash,
      parentIds: parents ? parents.split(' ') : [],
      subject: message.split(/\r?\n/, 1)[0]?.trim() || '(no commit message)',
      message,
      author: lines[1] || undefined,
      authorEmail: lines[2] || undefined,
      displayId: hash.slice(0, 7),
      timestamp: Number.isFinite(seconds) ? seconds * 1000 : undefined,
      references: parseDecorations(lines[5] ?? '', hash)
    })
  }
  return items
}

function parseDecorations(raw: string, revision: string): GitHistoryItemRef[] {
  const refs: GitHistoryItemRef[] = []
  for (const part of raw.split(',')) {
    const ref = part.trim()
    if (!ref || ref === 'HEAD' || /^refs\/remotes\/[^/]+\/HEAD$/.test(ref)) continue
    if (ref.startsWith('HEAD -> refs/heads/')) refs.push({ id: ref.slice(8), name: ref.slice(19), revision, category: 'branches' })
    else if (ref.startsWith('refs/heads/')) refs.push({ id: ref, name: ref.slice(11), revision, category: 'branches' })
    else if (ref.startsWith('refs/remotes/')) refs.push({ id: ref, name: ref.slice(13), revision, category: 'remote branches' })
    else if (ref.startsWith('tag: refs/tags/')) refs.push({ id: ref.slice(5), name: ref.slice(15), revision, category: 'tags' })
  }
  const order = (r: GitHistoryItemRef) => (r.category === 'branches' ? 1 : r.category === 'remote branches' ? 2 : 3)
  return refs.sort((a, b) => order(a) - order(b) || a.name.localeCompare(b.name))
}
