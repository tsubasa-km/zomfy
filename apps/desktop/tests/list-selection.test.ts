import { describe, expect, test } from 'bun:test'
import { createListSelection, nextSelection } from '../src/stores/list-selection.ts'

const order = ['a', 'b', 'c', 'd']
const empty = { ids: [], anchor: null }

describe('nextSelection', () => {
  test('the first Ctrl-click pairs the open item with the clicked one', () => {
    expect(nextSelection(empty, 'c', { toggle: true, range: false }, 'a', order)).toEqual({ ids: ['a', 'c'], anchor: 'c' })
  })

  test('Ctrl-click on a selected item drops it', () => {
    expect(nextSelection({ ids: ['a', 'c'], anchor: 'c' }, 'c', { toggle: true, range: false }, 'a', order).ids).toEqual(['a'])
  })

  test('Shift-click selects from the anchor', () => {
    expect(nextSelection({ ids: [], anchor: 'b' }, 'd', { toggle: false, range: true }, 'a', order)).toEqual({ ids: ['b', 'c', 'd'], anchor: 'b' })
  })

  test('Ctrl+Shift adds the range to what is selected', () => {
    expect(nextSelection({ ids: ['a'], anchor: 'c' }, 'd', { toggle: true, range: true }, null, order).ids).toEqual(['a', 'c', 'd'])
  })
})

describe('createListSelection', () => {
  test('acts on the selection only when the clicked item is in it', () => {
    const selection = createListSelection()
    selection.gesture('g1', 'b', { toggle: true, range: false }, 'a', order)
    expect(selection.targets('a')).toEqual(['a', 'b'])
    expect(selection.targets('d')).toEqual(['d'])
  })

  test('a gesture in another scope starts over', () => {
    const selection = createListSelection()
    selection.gesture('g1', 'b', { toggle: true, range: false }, 'a', order)
    selection.gesture('g2', 'd', { toggle: true, range: false }, 'c', order)
    expect(selection.get().ids).toEqual(['c', 'd'])
  })
})
