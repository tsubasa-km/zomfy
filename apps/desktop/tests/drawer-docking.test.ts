import { describe, expect, test } from 'bun:test'
import { drawerDragTarget, drawerResizeDepth } from '../src/components/tab-layout/drawer-docking'
import { isAllowedSettingValue } from '../src/stores/settings-store'

const bounds = { left: 100, top: 100, right: 700, bottom: 500, width: 600, height: 400 }

describe('tool drawer docking', () => {
  test('slides along the original edge and preserves the grab offset', () => {
    const start = { clientX: 405, clientY: 110 }
    expect(drawerDragTarget(bounds, 'top', start, { clientX: 255, clientY: 125 }, 5, false))
      .toEqual({ dock: { edge: 'top', position: 0.25 }, detached: false })
  })

  test('detaches in the middle and snaps to another edge as the pointer approaches', () => {
    const start = { clientX: 400, clientY: 110 }
    const middle = drawerDragTarget(bounds, 'top', start, { clientX: 400, clientY: 300 }, 0, false)
    expect(middle).toEqual({ dock: null, detached: true })
    expect(drawerDragTarget(bounds, 'top', start, { clientX: 114, clientY: 200 }, 0, middle.detached).dock)
      .toEqual({ edge: 'left', position: 0.25 })
    expect(drawerDragTarget(bounds, 'top', start, { clientX: 686, clientY: 400 }, 0, middle.detached).dock)
      .toEqual({ edge: 'right', position: 0.75 })
    expect(drawerDragTarget(bounds, 'top', start, { clientX: 550, clientY: 490 }, 0, middle.detached).dock)
      .toEqual({ edge: 'bottom', position: 0.75 })
    expect(drawerDragTarget(bounds, 'top', start, { clientX: 550, clientY: 110 }, 0, middle.detached).dock)
      .toEqual({ edge: 'top', position: 0.75 })
    expect(drawerDragTarget(bounds, 'top', start, { clientX: 710, clientY: 600 }, 0, middle.detached).dock).toBeNull()
  })

  test('resizes inward on every edge and fits panes smaller than the minimum', () => {
    const start = { clientX: 100, clientY: 100 }
    const end = { clientX: 120, clientY: 140 }
    expect(drawerResizeDepth('top', 320, start, end, 700)).toBe(360)
    expect(drawerResizeDepth('bottom', 320, start, end, 700)).toBe(280)
    expect(drawerResizeDepth('left', 320, start, end, 700)).toBe(340)
    expect(drawerResizeDepth('right', 320, start, end, 700)).toBe(300)
    expect(drawerResizeDepth('left', 320, start, end, 200)).toBe(200)
    expect(drawerResizeDepth('top', 200, end, start, 700)).toBe(192)
  })
})

describe('string-union settings', () => {
  test('keep only the values their key allows', () => {
    expect(isAllowedSettingValue('drawerOpenAction', 'hover')).toBe(true)
    expect(isAllowedSettingValue('drawerOpenAction', 'click')).toBe(true)
    expect(isAllowedSettingValue('drawerOpenAction', 'double-click')).toBe(false)
    expect(isAllowedSettingValue('drawerOpenAction', 1)).toBe(false)
  })

  test('leave keys without a list of values alone', () => {
    expect(isAllowedSettingValue('theme', 'anything')).toBe(true)
    expect(isAllowedSettingValue('toString', 'x')).toBe(true)
  })
})
