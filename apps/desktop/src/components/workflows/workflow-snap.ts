// Where a dragged step settles: lined up with another step's edge or centre when it comes close,
// otherwise on the canvas grid. The guides say what it lined up with.

export const GRID = 20
const REACH = 8

export interface SnapRect {
  x: number
  y: number
  width: number
  height: number
}

/** A line the dragged step lined up on, drawn from end to end of the steps it joins. */
export interface SnapGuide {
  axis: 'x' | 'y'
  at: number
  from: number
  to: number
}

const distance = (a: SnapRect, b: SnapRect) => Math.hypot(a.x + a.width / 2 - b.x - b.width / 2, a.y + a.height / 2 - b.y - b.height / 2)

export function snapRect(rect: SnapRect, others: SnapRect[]): { x: number; y: number; guides: SnapGuide[] } {
  // Start, centre and end of the dragged step against the same lines of each other step.
  const align = (axis: 'x' | 'y'): { pos: number; at?: number; other?: SnapRect } => {
    const pos = axis === 'x' ? rect.x : rect.y
    const size = axis === 'x' ? rect.width : rect.height
    let best: { shift: number; at: number; other: SnapRect; gap: number } | null = null
    for (const other of others) {
      const oPos = axis === 'x' ? other.x : other.y
      const oSize = axis === 'x' ? other.width : other.height
      for (const mine of [0, size / 2, size]) {
        for (const theirs of [0, oSize / 2, oSize]) {
          const shift = oPos + theirs - (pos + mine)
          if (Math.abs(shift) > REACH) continue
          // Equally close: the nearer step, so the guide stays short.
          const gap = distance(rect, other)
          if (!best || Math.abs(shift) < Math.abs(best.shift) || (Math.abs(shift) === Math.abs(best.shift) && gap < best.gap)) {
            best = { shift, at: oPos + theirs, other, gap }
          }
        }
      }
    }
    return best ? { pos: Math.round(pos + best.shift), at: best.at, other: best.other } : { pos: Math.round(pos / GRID) * GRID }
  }
  const x = align('x')
  const y = align('y')
  const guides: SnapGuide[] = []
  if (x.other && x.at !== undefined) {
    const from = Math.min(y.pos, x.other.y)
    guides.push({ axis: 'x', at: x.at, from, to: Math.max(y.pos + rect.height, x.other.y + x.other.height) })
  }
  if (y.other && y.at !== undefined) {
    const from = Math.min(x.pos, y.other.x)
    guides.push({ axis: 'y', at: y.at, from, to: Math.max(x.pos + rect.width, y.other.x + y.other.width) })
  }
  return { x: x.pos, y: y.pos, guides }
}
