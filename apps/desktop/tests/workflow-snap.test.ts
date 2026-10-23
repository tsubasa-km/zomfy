import { describe, expect, test } from 'bun:test'
import { snapRect } from '../src/components/workflows/workflow-snap.ts'

const card = (x: number, y: number) => ({ x, y, width: 200, height: 60 })

describe('snapRect', () => {
  test('lines up with a nearby step and says where', () => {
    const { x, y, guides } = snapRect(card(305, 186), [card(0, 180)])
    expect(y).toBe(180)
    expect(guides).toContainEqual({ axis: 'y', at: 180, from: 0, to: 500 })
    // Nothing close on x: the grid.
    expect(x).toBe(300)
  })

  test('centres line up too', () => {
    const { x, guides } = snapRect(card(104, 400), [{ x: 0, y: 0, width: 400, height: 60 }])
    expect(x).toBe(100)
    expect(guides.map((g) => g.axis)).toEqual(['x'])
  })

  test('far from every step it falls on the grid', () => {
    expect(snapRect(card(531, 289), [card(0, 0)])).toEqual({ x: 540, y: 280, guides: [] })
  })
})
