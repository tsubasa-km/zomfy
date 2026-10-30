import type { GitHistoryGraphColorId, GitHistoryItem, GitHistoryItemRef } from '@acp-harness/protocol'
import { t } from '@/i18n/i18n'

// Swimlane layout for the commit graph, ported from Orca's shared/git-history-graph.ts and
// git-history-boundary-rows.ts (itself VS Code's SCM graph model).

export const GIT_HISTORY_REF_COLOR: GitHistoryGraphColorId = 'git-graph-ref'
export const GIT_HISTORY_REMOTE_REF_COLOR: GitHistoryGraphColorId = 'git-graph-remote-ref'
export const GIT_HISTORY_BASE_REF_COLOR: GitHistoryGraphColorId = 'git-graph-base-ref'
const LANE_COLORS: readonly GitHistoryGraphColorId[] = [
  'git-graph-lane-1',
  'git-graph-lane-2',
  'git-graph-lane-3',
  'git-graph-lane-4',
  'git-graph-lane-5'
]
const INCOMING_ID = 'git-history-incoming-changes'
const OUTGOING_ID = 'git-history-outgoing-changes'

export type GitHistoryGraphNode = { id: string; color: GitHistoryGraphColorId }

export type GitHistoryItemViewModel = {
  historyItem: GitHistoryItem
  inputSwimlanes: GitHistoryGraphNode[]
  outputSwimlanes: GitHistoryGraphNode[]
  kind: 'HEAD' | 'node' | 'incoming-changes' | 'outgoing-changes'
}

const rotate = (index: number, length: number) => ((index % length) + length) % length
const cloneNode = (node: GitHistoryGraphNode): GitHistoryGraphNode => ({ id: node.id, color: node.color })

function findLastIndex<T>(items: readonly T[], predicate: (item: T) => boolean): number {
  for (let i = items.length - 1; i >= 0; i--) if (predicate(items[i]!)) return i
  return -1
}

function resolveNodeColor(
  id: string,
  hasParents: boolean,
  inputSwimlanes: GitHistoryGraphNode[],
  outputSwimlanes: GitHistoryGraphNode[]
): GitHistoryGraphColorId {
  const inputIndex = inputSwimlanes.findIndex((node) => node.id === id)
  const circleIndex = inputIndex !== -1 ? inputIndex : inputSwimlanes.length
  // A root ends its own lane, so its output slot may now belong to another history.
  if (!hasParents && inputIndex !== -1) return inputSwimlanes[inputIndex]!.color
  return outputSwimlanes[circleIndex]?.color ?? inputSwimlanes[circleIndex]?.color ?? GIT_HISTORY_REF_COLOR
}

function labelColor(item: GitHistoryItem, colorMap: Map<string, GitHistoryGraphColorId | undefined>): GitHistoryGraphColorId | undefined {
  if (item.id === INCOMING_ID) return GIT_HISTORY_REMOTE_REF_COLOR
  if (item.id === OUTGOING_ID) return GIT_HISTORY_REF_COLOR
  for (const ref of item.references ?? []) {
    const color = colorMap.get(ref.id)
    if (color !== undefined) return color
  }
  return undefined
}

function compareRefs(a: GitHistoryItemRef, b: GitHistoryItemRef, current?: GitHistoryItemRef, remote?: GitHistoryItemRef, base?: GitHistoryItemRef): number {
  const order = (ref: GitHistoryItemRef) =>
    ref.id === current?.id ? 1 : ref.id === remote?.id ? 2 : ref.id === base?.id ? 3 : ref.color !== undefined ? 4 : 99
  return order(a) - order(b)
}

export function buildDefaultGitHistoryColorMap(input: {
  currentRef?: GitHistoryItemRef
  remoteRef?: GitHistoryItemRef
  baseRef?: GitHistoryItemRef
}): Map<string, GitHistoryGraphColorId | undefined> {
  const map = new Map<string, GitHistoryGraphColorId | undefined>()
  if (input.currentRef) map.set(input.currentRef.id, GIT_HISTORY_REF_COLOR)
  if (input.remoteRef) map.set(input.remoteRef.id, GIT_HISTORY_REMOTE_REF_COLOR)
  if (input.baseRef) map.set(input.baseRef.id, GIT_HISTORY_BASE_REF_COLOR)
  return map
}

export function buildGitHistoryViewModels(
  historyItems: GitHistoryItem[],
  colorMap: Map<string, GitHistoryGraphColorId | undefined>,
  currentRef?: GitHistoryItemRef,
  remoteRef?: GitHistoryItemRef,
  baseRef?: GitHistoryItemRef,
  addIncomingChanges?: boolean,
  addOutgoingChanges?: boolean,
  mergeBase?: string
): GitHistoryItemViewModel[] {
  let colorIndex = -1
  const viewModels: GitHistoryItemViewModel[] = []
  let itemsById: Map<string, GitHistoryItem> | undefined

  for (const historyItem of historyItems) {
    const firstParentId = historyItem.parentIds[0]
    const kind = historyItem.id === currentRef?.revision ? 'HEAD' : 'node'
    const inputSwimlanes = (viewModels.at(-1)?.outputSwimlanes ?? []).map(cloneNode)
    const outputSwimlanes: GitHistoryGraphNode[] = []
    let firstParentAdded = false

    for (const node of inputSwimlanes) {
      if (node.id === historyItem.id) {
        if (!firstParentAdded && firstParentId !== undefined) {
          outputSwimlanes.push({ id: firstParentId, color: labelColor(historyItem, colorMap) ?? node.color })
          firstParentAdded = true
        }
        continue
      }
      outputSwimlanes.push(cloneNode(node))
    }

    for (let index = firstParentAdded ? 1 : 0; index < historyItem.parentIds.length; index++) {
      let color: GitHistoryGraphColorId | undefined
      if (index === 0) {
        color = labelColor(historyItem, colorMap)
      } else {
        if (!itemsById) {
          itemsById = new Map()
          for (const candidate of historyItems) if (!itemsById.has(candidate.id)) itemsById.set(candidate.id, candidate)
        }
        const parent = itemsById.get(historyItem.parentIds[index]!)
        color = parent ? labelColor(parent, colorMap) : undefined
      }
      if (!color) {
        colorIndex = rotate(colorIndex + 1, LANE_COLORS.length)
        color = LANE_COLORS[colorIndex]!
      }
      outputSwimlanes.push({ id: historyItem.parentIds[index]!, color })
    }

    const references = (historyItem.references ?? [])
      .map((ref) => {
        let color = colorMap.get(ref.id)
        if (colorMap.has(ref.id) && color === undefined) {
          color = resolveNodeColor(historyItem.id, firstParentId !== undefined, inputSwimlanes, outputSwimlanes)
        }
        return { ...ref, color }
      })
      .sort((a, b) => compareRefs(a, b, currentRef, remoteRef, baseRef))

    viewModels.push({ historyItem: { ...historyItem, references }, kind, inputSwimlanes, outputSwimlanes })
  }

  addBoundaryRows(viewModels, currentRef, remoteRef, addIncomingChanges, addOutgoingChanges, mergeBase)
  return viewModels
}

export function getGitHistoryItemColor(viewModel: GitHistoryItemViewModel): GitHistoryGraphColorId {
  return resolveNodeColor(
    viewModel.historyItem.id,
    viewModel.historyItem.parentIds.length > 0,
    viewModel.inputSwimlanes,
    viewModel.outputSwimlanes
  )
}

export function getGitHistoryItemLaneIndex(viewModel: GitHistoryItemViewModel): number {
  const inputIndex = viewModel.inputSwimlanes.findIndex((node) => node.id === viewModel.historyItem.id)
  return inputIndex !== -1 ? inputIndex : viewModel.inputSwimlanes.length
}

export function getGitHistoryMergeParentLaneIndex(viewModel: GitHistoryItemViewModel, parentId: string): number {
  return findLastIndex(viewModel.outputSwimlanes, (node) => node.id === parentId)
}

export function isBoundaryRow(viewModel: GitHistoryItemViewModel): boolean {
  return viewModel.kind === 'incoming-changes' || viewModel.kind === 'outgoing-changes'
}

// ── Incoming / outgoing boundary rows ───────────────────────────────────

const hasNode = (nodes: readonly GitHistoryGraphNode[], id: string, color?: GitHistoryGraphColorId) =>
  nodes.some((node) => node.id === id && (color === undefined || node.color === color))

const remoteBoundaryInputNode = (node: GitHistoryGraphNode, mergeBase: string): GitHistoryGraphNode =>
  node.id === mergeBase && node.color === GIT_HISTORY_REMOTE_REF_COLOR ? { ...node, id: INCOMING_ID } : cloneNode(node)

function ensureIncomingRemoteLane(inputSwimlanes: GitHistoryGraphNode[], outputSwimlanes: GitHistoryGraphNode[], mergeBase: string): void {
  // HEAD-only history omits upstream commits, so synthesize the remote lane those rows would have drawn.
  if (!hasNode(outputSwimlanes, mergeBase, GIT_HISTORY_REMOTE_REF_COLOR)) {
    const local = outputSwimlanes.findIndex((node) => node.id === mergeBase && node.color === GIT_HISTORY_REF_COLOR)
    outputSwimlanes.splice(local === -1 ? inputSwimlanes.length : local + 1, 0, { id: mergeBase, color: GIT_HISTORY_REMOTE_REF_COLOR })
  }
  if (hasNode(inputSwimlanes, INCOMING_ID, GIT_HISTORY_REMOTE_REF_COLOR)) return
  const remote = outputSwimlanes.findIndex((node) => node.id === mergeBase && node.color === GIT_HISTORY_REMOTE_REF_COLOR)
  inputSwimlanes.splice(remote === -1 ? inputSwimlanes.length : remote, 0, { id: INCOMING_ID, color: GIT_HISTORY_REMOTE_REF_COLOR })
}

function addBoundaryRows(
  viewModels: GitHistoryItemViewModel[],
  currentRef?: GitHistoryItemRef,
  remoteRef?: GitHistoryItemRef,
  addIncoming?: boolean,
  addOutgoing?: boolean,
  mergeBase?: string
): void {
  if (currentRef?.revision === remoteRef?.revision || !mergeBase) return
  if (addIncoming && remoteRef && remoteRef.revision !== mergeBase) addIncomingRow(viewModels, remoteRef, mergeBase)
  if (addOutgoing && currentRef?.revision && currentRef.revision !== mergeBase) addOutgoingRow(viewModels, currentRef)
}

function addIncomingRow(viewModels: GitHistoryItemViewModel[], remoteRef: GitHistoryItemRef, mergeBase: string): void {
  const beforeIndex = findLastIndex(viewModels, (vm) => vm.outputSwimlanes.some((node) => node.id === mergeBase))
  const afterIndex = viewModels.findIndex((vm) => vm.historyItem.id === mergeBase)
  if (afterIndex === -1) return
  const before = beforeIndex !== -1 ? viewModels[beforeIndex] : undefined
  if (before?.historyItem.parentIds.length === 2 && before.historyItem.parentIds.includes(mergeBase)) return

  const after = viewModels[afterIndex]!
  const inputSwimlanes = before?.outputSwimlanes.map((node) => remoteBoundaryInputNode(node, mergeBase)) ?? after.inputSwimlanes.map(cloneNode)
  const outputSwimlanes = after.inputSwimlanes.map(cloneNode)
  ensureIncomingRemoteLane(inputSwimlanes, outputSwimlanes, mergeBase)
  if (before !== undefined) {
    viewModels[beforeIndex] = {
      ...before,
      inputSwimlanes: before.inputSwimlanes.map((node) => remoteBoundaryInputNode(node, mergeBase)),
      outputSwimlanes: inputSwimlanes.map(cloneNode)
    }
  }
  viewModels.splice(afterIndex, 0, {
    historyItem: { id: INCOMING_ID, parentIds: [mergeBase], author: remoteRef.name, subject: t('Incoming Changes'), message: '' },
    kind: 'incoming-changes',
    inputSwimlanes,
    outputSwimlanes
  })
  viewModels[afterIndex + 1] = { ...after, inputSwimlanes: outputSwimlanes.map(cloneNode) }
}

function addOutgoingRow(viewModels: GitHistoryItemViewModel[], currentRef: GitHistoryItemRef): void {
  const revision = currentRef.revision!
  const index = viewModels.findIndex((vm) => vm.kind === 'HEAD' && vm.historyItem.id === revision)
  if (index === -1) return
  const inputSwimlanes = viewModels[index]!.inputSwimlanes.map(cloneNode)
  viewModels.splice(index, 0, {
    historyItem: { id: OUTGOING_ID, parentIds: [revision], author: currentRef.name, subject: t('Outgoing Changes'), message: '' },
    kind: 'outgoing-changes',
    inputSwimlanes,
    outputSwimlanes: inputSwimlanes.concat({ id: revision, color: GIT_HISTORY_REF_COLOR })
  })
  viewModels[index + 1]!.inputSwimlanes.push({ id: revision, color: GIT_HISTORY_REF_COLOR })
}

/** A local branch and its own remote-tracking ref on the same commit collapse to one pill. */
export function dedupeRemoteTrackingRefs(refs: readonly GitHistoryItemRef[], preserveRefIds: readonly string[] = []): GitHistoryItemRef[] {
  const local = new Set(refs.filter((r) => r.category === 'branches').map((r) => r.name))
  if (local.size === 0) return [...refs]
  const counts = new Map<string, number>()
  for (const ref of refs) {
    const parts = ref.name.split('/')
    if (ref.category !== 'remote branches' || parts.length !== 2 || !local.has(parts[1]!)) continue
    counts.set(parts[1]!, (counts.get(parts[1]!) ?? 0) + 1)
  }
  return refs.filter((ref) => {
    if (ref.category !== 'remote branches' || preserveRefIds.includes(ref.id)) return true
    const parts = ref.name.split('/')
    return parts.length !== 2 || !local.has(parts[1]!) || counts.get(parts[1]!) !== 1
  })
}
