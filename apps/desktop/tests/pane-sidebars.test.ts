import { describe, expect, test } from 'bun:test'
import { paneSidebarKey, prunePaneSidebars, type PaneSidebarState } from '../src/stores/pane-sidebar-store'

const open: PaneSidebarState = { open: true, panel: 'panel:checks' }
const closed: PaneSidebarState = { open: false, panel: 'panel:explorer', width: 400 }

describe('pane sidebars', () => {
  test('keys name the layout and the pane', () => {
    expect(paneSidebarKey('window', 'g1')).toBe('window#g1')
  })

  test('drops the panes that are gone, only in the layout given', () => {
    const state = { 'window#g1': open, 'window#g2': closed, 'ws-1#g2': closed }
    expect(prunePaneSidebars(state, 'window', ['g1'], 'g1')).toEqual({ 'window#g1': open, 'ws-1#g2': closed })
  })

  test('hands back the same object when nothing changes', () => {
    const state = { 'window#g1': open }
    expect(prunePaneSidebars(state, 'window', ['g1', 'g2'], 'g1')).toBe(state)
  })

  test("moves the layout's old single sidebar to the focused pane", () => {
    expect(prunePaneSidebars({ window: open }, 'window', ['g1', 'g2'], 'g2')).toEqual({ 'window#g2': open })
  })

  test('keeps what the focused pane has over the old single sidebar', () => {
    expect(prunePaneSidebars({ window: open, 'window#g1': closed }, 'window', ['g1'], 'g1')).toEqual({ 'window#g1': closed })
  })
})
