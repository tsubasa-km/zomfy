import { describe, expect, test } from 'bun:test'
import { containsPoint, dropHintRect, resolvePaneEdgeZone, type Rect } from '../src/components/tab-layout/tab-drop-geometry'

// A pane 1000 wide at x 100: tab strip 30 high, body below it, and a 300-wide right sidebar.
const pane: Rect = { left: 100, top: 50, width: 1000, height: 630 }
const body: Rect = { left: 100, top: 80, width: 700, height: 600 }
const sidebar: Rect = { left: 800, top: 50, width: 300, height: 630 }
const at = (x: number, y: number) => ({ x, y })

describe('resolvePaneEdgeZone', () => {
  test('side bands are a fifth of the whole pane, sidebar included', () => {
    expect(resolvePaneEdgeZone(pane, body, at(299, 380), sidebar)).toBe('left')
    expect(resolvePaneEdgeZone(pane, body, at(301, 380), sidebar)).toBeNull()
  })

  test('the right band is measured on the pane, not on the content left of the sidebar', () => {
    // 75% of the content area (the old right band) is the pane's middle now.
    expect(resolvePaneEdgeZone(pane, body, at(660, 380), sidebar)).toBeNull()
    expect(resolvePaneEdgeZone(pane, body, at(901, 380), null)).toBe('right')
  })

  test('anywhere over the sidebar is the right edge, top and bottom too', () => {
    expect(resolvePaneEdgeZone(pane, body, at(820, 60), sidebar)).toBe('right')
    expect(resolvePaneEdgeZone(pane, body, at(820, 670), sidebar)).toBe('right')
    expect(resolvePaneEdgeZone(pane, body, at(820, 380), sidebar)).toBe('right')
  })

  test('vertical bands are a fifth of the body', () => {
    expect(resolvePaneEdgeZone(pane, body, at(500, 199), sidebar)).toBe('up')
    expect(resolvePaneEdgeZone(pane, body, at(500, 201), sidebar)).toBeNull()
    expect(resolvePaneEdgeZone(pane, body, at(500, 561), sidebar)).toBe('down')
  })

  test('side bands win over vertical ones in the corners', () => {
    expect(resolvePaneEdgeZone(pane, body, at(150, 90), sidebar)).toBe('left')
  })

  test('a body of no height has only side bands', () => {
    expect(resolvePaneEdgeZone(pane, { ...body, height: 0 }, at(500, 80), null)).toBeNull()
  })

  test('without a sidebar the pane is the content area', () => {
    const content: Rect = { left: 100, top: 50, width: 700, height: 630 }
    expect(resolvePaneEdgeZone(content, body, at(661, 380))).toBe('right')
    expect(resolvePaneEdgeZone(content, body, at(659, 380))).toBeNull()
  })
})

describe('dropHintRect', () => {
  test('each zone covers the share of the pane its split takes', () => {
    expect(dropHintRect('left')).toEqual({ left: 0, top: 0, width: 0.5, height: 1 })
    expect(dropHintRect('right')).toEqual({ left: 0.5, top: 0, width: 0.5, height: 1 })
    expect(dropHintRect('up')).toEqual({ left: 0, top: 0, width: 1, height: 0.5 })
    expect(dropHintRect('down')).toEqual({ left: 0, top: 0.5, width: 1, height: 0.5 })
    expect(dropHintRect('center')).toEqual({ left: 0, top: 0, width: 1, height: 1 })
  })
})

describe('containsPoint', () => {
  test('includes the top-left edge and excludes the bottom-right one', () => {
    expect(containsPoint(sidebar, at(800, 50))).toBe(true)
    expect(containsPoint(sidebar, at(1100, 100))).toBe(false)
    expect(containsPoint(sidebar, at(799, 100))).toBe(false)
  })
})
