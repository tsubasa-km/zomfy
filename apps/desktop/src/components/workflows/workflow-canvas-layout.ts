import { cyclesOf, workflowCycles, type Workflow, type WorkflowCycle, type WorkflowEdge, type WorkflowNode } from '@acp-harness/protocol'

// Where the canvas draws cycle frames and edge routes. Edges are routed orthogonally: forward ones
// leave right and enter left; ones back to an earlier step run underneath in their own lane, inner
// loops above outer ones; ones to a step above or below use the top and bottom sides. Ports along a
// side are spread out so two edges never share a segment, and a frame grows to hold its loops.

const CARD = { width: 208, height: 60 }
const PAD = 18
const TITLE = 26
const LANE_GAP = 26
const LANE_STEP = 22

export interface Point {
  x: number
  y: number
}

export interface EdgeRoute {
  points: Point[]
  label: Point
}

export interface CycleBox {
  x: number
  y: number
  width: number
  height: number
  depth: number
}

interface Rect {
  x: number
  y: number
  r: number
  b: number
}

type Kind = 'forward' | 'back' | 'down' | 'up'

export function canvasLayout(
  workflow: Workflow,
  sizes: Record<string, { width: number; height: number }>
): { boxes: Map<string, CycleBox>; routes: Map<string, EdgeRoute> } {
  const cycles = workflowCycles(workflow)
  const byId = new Map(workflow.nodes.map((n) => [n.id, n]))
  const rectOf = (node: WorkflowNode): Rect => {
    const size = sizes[node.id] ?? CARD
    return { x: node.x, y: node.y, r: node.x + size.width, b: node.y + size.height }
  }
  const rects = new Map(workflow.nodes.map((n) => [n.id, rectOf(n)]))

  const edges = workflow.edges.filter((e) => byId.has(e.from) && byId.has(e.to))
  const kinds = new Map<string, Kind>()
  for (const e of edges) {
    const s = rects.get(e.from)!
    const t = rects.get(e.to)!
    kinds.set(e.id, t.x >= s.r + 20 ? 'forward' : e.from === e.to || t.r <= s.x - 20 ? 'back' : t.y > s.y ? 'down' : 'up')
  }

  // The innermost cycle holding both ends owns a back edge's lane.
  const homeOf = (e: WorkflowEdge): string | null => {
    const to = cyclesOf(workflow, e.to)
    return cyclesOf(workflow, e.from).find((c) => to.some((x) => x.id === c.id))?.id ?? null
  }
  const depthOf = (cycle: WorkflowCycle): number => {
    let depth = 0
    for (let c = cycle; c.parentId && depth <= cycles.length; depth++) {
      const parent = cycles.find((p) => p.id === c.parentId)
      if (!parent) break
      c = parent
    }
    return depth
  }

  // Deepest cycles first, so a frame's size is known before the lanes around it are placed.
  const groups: (WorkflowCycle | null)[] = [...[...cycles].sort((a, b) => depthOf(b) - depthOf(a)), null]
  const boxes = new Map<string, CycleBox>()
  const lanes = new Map<string, number>()
  for (const group of groups) {
    const gid = group?.id ?? null
    const content: Rect[] = workflow.nodes
      .filter((n) => (cyclesOf(workflow, n.id)[0]?.id ?? null) === gid)
      .map((n) => rects.get(n.id)!)
    for (const child of cycles.filter((c) => (c.parentId ?? null) === gid)) {
      const box = boxes.get(child.id)
      if (box) content.push({ x: box.x, y: box.y, r: box.x + box.width, b: box.y + box.height })
    }
    const span = (e: WorkflowEdge) => {
      const s = rects.get(e.from)!
      const t = rects.get(e.to)!
      return { x: Math.min(s.x, t.x), r: Math.max(s.r, t.r) }
    }
    const mine = edges
      .filter((e) => kinds.get(e.id) === 'back' && homeOf(e) === gid)
      .sort((a, b) => span(a).r - span(a).x - (span(b).r - span(b).x))
    const placed: { x: number; r: number; y: number }[] = []
    for (const e of mine) {
      const { x, r } = span(e)
      const overlaps = (o: { x: number; r: number }) => o.x < r && o.r > x
      let y = Math.max(...content.filter(overlaps).map((c) => c.b), rects.get(e.from)!.b, rects.get(e.to)!.b) + LANE_GAP
      for (const p of placed.filter(overlaps)) y = Math.max(y, p.y + LANE_STEP)
      placed.push({ x, r, y })
      lanes.set(e.id, y)
    }
    if (!group || content.length === 0) continue
    const bottom = Math.max(...content.map((c) => c.b), ...placed.map((p) => p.y + 10))
    const x = Math.min(...content.map((c) => c.x)) - PAD
    const y = Math.min(...content.map((c) => c.y)) - PAD - TITLE
    boxes.set(group.id, {
      x,
      y,
      width: Math.max(...content.map((c) => c.r)) + PAD - x,
      height: bottom + PAD - y,
      depth: depthOf(group)
    })
  }

  // A card between a loop's end and its lane: that end goes round it on the outside instead of through it.
  const blocked = new Map<string, Rect[]>()
  for (const e of edges) {
    const lane = lanes.get(e.id)
    if (lane === undefined) continue
    for (const [end, nodeId] of [['out', e.from], ['in', e.to]] as const) {
      const own = rects.get(nodeId)!
      const inset = (own.r - own.x) * 0.2
      const cards = workflow.nodes
        .filter((n) => n.id !== e.from && n.id !== e.to)
        .map((n) => rects.get(n.id)!)
        .filter((c) => c.x < own.r - inset && c.r > own.x + inset && c.b > own.b && c.y < lane)
      if (cards.length > 0) blocked.set(`${e.id}:${end}`, cards)
    }
  }

  // Ports on the top and bottom sides, spread along the card in an order that keeps lanes uncrossed:
  // departing loops (heading left) on the left, arriving ones (from the right) on the right, outer
  // lanes towards the middle; steps above/below between them.
  const sidePorts = new Map<string, { edge: string; rank: number }[]>()
  const addPort = (node: string, side: 'top' | 'bottom', edge: string, rank: number) => {
    const key = `${node}:${side}`
    sidePorts.set(key, [...(sidePorts.get(key) ?? []), { edge, rank }])
  }
  edges.forEach((e, i) => {
    const kind = kinds.get(e.id)!
    const lane = lanes.get(e.id) ?? 0
    if (kind === 'back') {
      if (!blocked.has(`${e.id}:out`)) addPort(e.from, 'bottom', `${e.id}:out`, -1e6 + lane)
      if (!blocked.has(`${e.id}:in`)) addPort(e.to, 'bottom', `${e.id}:in`, 1e6 - lane)
    } else if (kind === 'down') {
      addPort(e.from, 'bottom', `${e.id}:out`, i)
      addPort(e.to, 'top', `${e.id}:in`, i)
    } else if (kind === 'up') {
      addPort(e.from, 'top', `${e.id}:out`, i)
      addPort(e.to, 'bottom', `${e.id}:in`, i)
    }
  })
  const portX = new Map<string, number>()
  for (const [key, ports] of sidePorts) {
    const rect = rects.get(key.slice(0, key.lastIndexOf(':')))!
    const width = rect.r - rect.x
    ports.sort((a, b) => a.rank - b.rank)
    ports.forEach((p, i) => portX.set(p.edge, rect.x + width * 0.2 + (width * 0.6 * (i + 1)) / (ports.length + 1)))
  }

  const routes = new Map<string, EdgeRoute>()
  for (const e of edges) {
    const s = rects.get(e.from)!
    const t = rects.get(e.to)!
    const kind = kinds.get(e.id)!
    if (kind === 'forward') {
      const from = { x: s.r, y: (s.y + s.b) / 2 }
      const to = { x: t.x, y: (t.y + t.b) / 2 }
      if (Math.abs(from.y - to.y) < 2) {
        routes.set(e.id, { points: [from, { x: to.x, y: from.y }], label: { x: (from.x + to.x) / 2, y: from.y } })
        continue
      }
      // Branches fork at the gap's middle; the label sits on the branch's own upright leg.
      const mid = (from.x + to.x) / 2
      routes.set(e.id, {
        points: [from, { x: mid, y: from.y }, { x: mid, y: to.y }, to],
        label: { x: mid, y: (from.y + to.y) / 2 }
      })
    } else if (kind === 'back') {
      const lane = lanes.get(e.id)!
      const below = blocked.get(`${e.id}:out`)
      const under = blocked.get(`${e.id}:in`)
      const sx = below ? Math.max(s.r, ...below.map((c) => c.r)) + 14 : portX.get(`${e.id}:out`)!
      const tx = under ? Math.min(t.x, ...under.map((c) => c.x)) - 14 : portX.get(`${e.id}:in`)!
      const head: Point[] = below
        ? [
            { x: s.r, y: s.b - 12 },
            { x: sx, y: s.b - 12 }
          ]
        : [{ x: sx, y: s.b }]
      const tail: Point[] = under
        ? [
            { x: tx, y: t.b - 12 },
            { x: t.x, y: t.b - 12 }
          ]
        : [{ x: tx, y: t.b }]
      routes.set(e.id, {
        points: [...head, { x: sx, y: lane }, { x: tx, y: lane }, ...tail],
        label: { x: (sx + tx) / 2, y: lane }
      })
    } else {
      const down = kind === 'down'
      const from = { x: portX.get(`${e.id}:out`)!, y: down ? s.b : s.y }
      const to = { x: portX.get(`${e.id}:in`)!, y: down ? t.y : t.b }
      const mid = (from.y + to.y) / 2
      const points = Math.abs(from.x - to.x) < 2 ? [from, to] : [from, { x: from.x, y: mid }, { x: to.x, y: mid }, to]
      // Near the source, so a pair running opposite ways between two steps keeps its labels apart.
      routes.set(e.id, { points, label: { x: from.x, y: from.y + (to.y - from.y) * 0.3 } })
    }
  }
  return { boxes, routes }
}

/** An SVG path through `points` with rounded corners. */
export function routePath(points: Point[], radius = 8): string {
  if (points.length === 0) return ''
  let d = `M ${points[0]!.x} ${points[0]!.y}`
  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1]!
    const at = points[i]!
    const next = points[i + 1]!
    const r = Math.min(radius, Math.hypot(at.x - prev.x, at.y - prev.y) / 2, Math.hypot(next.x - at.x, next.y - at.y) / 2)
    const inX = at.x - Math.sign(at.x - prev.x) * r
    const inY = at.y - Math.sign(at.y - prev.y) * r
    const outX = at.x + Math.sign(next.x - at.x) * r
    const outY = at.y + Math.sign(next.y - at.y) * r
    d += ` L ${inX} ${inY} Q ${at.x} ${at.y} ${outX} ${outY}`
  }
  const last = points.at(-1)!
  return `${d} L ${last.x} ${last.y}`
}
