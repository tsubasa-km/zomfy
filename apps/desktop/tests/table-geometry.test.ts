import { describe, expect, test } from 'bun:test'
import { PagedScroll, indexAt, selectionAfterKey, selectionRange, type Selection } from '../src/components/editor/table/table-geometry.ts'

describe('PagedScroll', () => {
  test('a list that fits in an element scrolls as it is', () => {
    const paged = new PagedScroll()
    paged.configure(50_000, 600, 100_000)
    expect(paged.real).toBe(50_000)
    expect(paged.onScroll(1234)).toBeNull()
    expect(paged.top).toBe(1234)
    expect(paged.offset).toBe(0)
  })

  test('a taller list moves pixel for pixel when scrolled a little, across pages too', () => {
    const paged = new PagedScroll()
    paged.configure(24_000_000, 600, 1_000_000)
    expect(paged.real).toBe(1_000_000)
    let scrollTop = 0
    let top = 0
    for (let i = 0; i < 5000; i++) {
      scrollTop += 100
      top += 100
      const moved = paged.onScroll(scrollTop)
      if (moved !== null) scrollTop = moved
      expect(paged.top).toBe(top)
      expect(scrollTop).toBeGreaterThanOrEqual(0)
      expect(scrollTop).toBeLessThanOrEqual(paged.real - 600)
    }
    // Half a million pixels of list went by, more than a tenth of the element is tall.
    expect(paged.offset).toBeGreaterThan(0)
  })

  test('a long drag of the scrollbar lands in proportion, and its end is the end of the list', () => {
    const paged = new PagedScroll()
    paged.configure(24_000_000, 600, 1_000_000)
    paged.onScroll(500_000)
    expect(paged.top).toBeGreaterThan(11_000_000)
    expect(paged.top).toBeLessThan(13_000_000)
    paged.onScroll(1_000_000 - 600)
    expect(paged.top).toBe(24_000_000 - 600)
  })

  test('scrollTo reaches any row, and a change of size keeps the place', () => {
    const paged = new PagedScroll()
    paged.configure(24_000_000, 600, 1_000_000)
    const scrollTop = paged.scrollTo(17_654_321)
    expect(paged.top).toBe(17_654_321)
    expect(scrollTop).toBeGreaterThanOrEqual(0)
    expect(scrollTop).toBeLessThanOrEqual(1_000_000 - 600)
    expect(paged.scrollTo(99_999_999)).toBe(1_000_000 - 600)
    expect(paged.top).toBe(24_000_000 - 600)
    paged.scrollTo(5_000_000)
    paged.configure(30_000_000, 800, 1_000_000)
    expect(paged.top).toBe(5_000_000)
    // A list that shrank under the place scrolled to ends at its last row.
    paged.configure(1000, 800, 1_000_000)
    expect(paged.top).toBe(200)
    paged.configure(100, 800, 1_000_000)
    expect(paged.top).toBe(0)
  })
})

test('indexAt finds the column a position falls in', () => {
  const starts = Float64Array.from([0, 50, 120, 300])
  expect(indexAt(starts, 3, 0)).toBe(0)
  expect(indexAt(starts, 3, 49)).toBe(0)
  expect(indexAt(starts, 3, 50)).toBe(1)
  expect(indexAt(starts, 3, 299)).toBe(2)
  expect(indexAt(starts, 3, 5000)).toBe(2)
  expect(indexAt(starts, 0, 10)).toBe(0)
})

describe('selection', () => {
  const at = (row: number, col: number): Selection => ({ kind: 'cells', anchorRow: row, anchorCol: col, row, col })
  const press = (selection: Selection | null, key: string, flags: { shift?: boolean; mod?: boolean } = {}): Selection | null =>
    selectionAfterKey(selection, { key, shift: flags.shift ?? false, mod: flags.mod ?? false }, 100, 10, 20)

  test('arrows move the cursor and stop at the edges', () => {
    expect(press(at(5, 5), 'ArrowDown')).toEqual(at(6, 5))
    expect(press(at(0, 0), 'ArrowUp')).toEqual(at(0, 0))
    expect(press(at(99, 9), 'ArrowRight')).toEqual(at(99, 9))
    expect(press(null, 'ArrowDown')).toEqual(at(1, 0))
  })

  test('Shift extends from the anchor', () => {
    const extended = press(press(at(5, 5), 'ArrowDown', { shift: true }), 'ArrowRight', { shift: true })!
    expect(extended).toEqual({ kind: 'cells', anchorRow: 5, anchorCol: 5, row: 6, col: 6 })
    expect(selectionRange(extended, 100, 10)).toEqual({ rowFrom: 5, rowTo: 6, colFrom: 5, colTo: 6 })
  })

  test('Ctrl jumps to the edge, Home and End along the row, pages by the viewport', () => {
    expect(press(at(5, 5), 'ArrowDown', { mod: true })).toEqual(at(99, 5))
    expect(press(at(5, 5), 'Home')).toEqual(at(5, 0))
    expect(press(at(5, 5), 'End', { mod: true })).toEqual(at(99, 9))
    expect(press(at(5, 5), 'PageDown')).toEqual(at(25, 5))
    expect(press(at(5, 5), 'PageUp')).toEqual(at(0, 5))
  })

  test('whole rows, whole columns and everything', () => {
    const rows = press(at(5, 5), ' ', { shift: true })!
    expect(selectionRange(rows, 100, 10)).toEqual({ rowFrom: 5, rowTo: 5, colFrom: 0, colTo: 9 })
    expect(selectionRange(press(rows, 'ArrowDown', { shift: true })!, 100, 10)).toEqual({ rowFrom: 5, rowTo: 6, colFrom: 0, colTo: 9 })
    expect(selectionRange(press(at(5, 5), ' ', { mod: true })!, 100, 10)).toEqual({ rowFrom: 0, rowTo: 99, colFrom: 5, colTo: 5 })
    expect(selectionRange(press(at(5, 5), 'a', { mod: true })!, 100, 10)).toEqual({ rowFrom: 0, rowTo: 99, colFrom: 0, colTo: 9 })
  })

  test('other keys are left alone, and a selection past a table that shrank is clamped', () => {
    expect(press(at(5, 5), 'x')).toBeNull()
    expect(selectionAfterKey(at(5, 5), { key: 'ArrowDown', shift: false, mod: false }, 0, 0, 20)).toBeNull()
    expect(selectionRange({ kind: 'cells', anchorRow: 2, anchorCol: 2, row: 500, col: 50 }, 100, 10)).toEqual({ rowFrom: 2, rowTo: 99, colFrom: 2, colTo: 9 })
  })
})
