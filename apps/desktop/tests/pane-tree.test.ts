import { describe, expect, test } from 'bun:test'
import {
  appendPane,
  insertPane,
  keepPanes,
  movePane,
  paneLeaves,
  panesFromColumns,
  readPaneTree,
  removePane,
  replacePane,
  resizePanes,
  swapPanes,
  type PaneNode
} from '../src/lib/pane-tree.ts'

const row = (...ids: string[]): PaneNode => ({ split: 'row', children: ids.map((leaf) => ({ leaf })), sizes: ids.map(() => 1) })

describe('pane tree', () => {
  test('a pane dropped on the right of another joins its row and takes half its share', () => {
    const tree = insertPane(row('a', 'b'), 'b', 'c', 'right')
    expect(paneLeaves(tree)).toEqual(['a', 'b', 'c'])
    expect(tree).toEqual({ split: 'row', children: [{ leaf: 'a' }, { leaf: 'b' }, { leaf: 'c' }], sizes: [1, 0.5, 0.5] })
  })

  test('a pane dropped below another splits that one into a column', () => {
    const tree = insertPane(row('a', 'b'), 'a', 'c', 'bottom')
    expect(tree).toEqual({
      split: 'row',
      children: [{ split: 'column', children: [{ leaf: 'a' }, { leaf: 'c' }], sizes: [1, 1] }, { leaf: 'b' }],
      sizes: [1, 1]
    })
  })

  test('a lone pane splits when another lands on it', () => {
    expect(insertPane({ leaf: 'a' }, 'a', 'b', 'top')).toEqual({ split: 'column', children: [{ leaf: 'b' }, { leaf: 'a' }], sizes: [1, 1] })
  })

  test('moving a pane takes it out of its old place first', () => {
    const tree = movePane(row('a', 'b', 'c'), 'a', 'c', 'bottom')
    expect(paneLeaves(tree)).toEqual(['b', 'c', 'a'])
    expect(tree).toEqual({
      split: 'row',
      children: [{ leaf: 'b' }, { split: 'column', children: [{ leaf: 'c' }, { leaf: 'a' }], sizes: [1, 1] }],
      sizes: [1, 1]
    })
  })

  test('removing a pane collapses a split left with one child, and one pane alone is no layout', () => {
    const tree = insertPane(row('a', 'b'), 'a', 'c', 'bottom')
    expect(removePane(tree, 'c')).toEqual(row('a', 'b'))
    expect(removePane(row('a', 'b'), 'a')).toBeNull()
    expect(keepPanes(tree, (id) => id !== 'b')).toEqual({ split: 'column', children: [{ leaf: 'a' }, { leaf: 'c' }], sizes: [1, 1] })
  })

  test('replace, swap, append and resize', () => {
    expect(paneLeaves(replacePane(row('a', 'b'), 'b', 'x'))).toEqual(['a', 'x'])
    expect(paneLeaves(swapPanes(row('a', 'b', 'c'), 'a', 'c'))).toEqual(['c', 'b', 'a'])
    expect(paneLeaves(appendPane(row('a', 'b'), 'c'))).toEqual(['a', 'b', 'c'])
    expect(appendPane({ leaf: 'a' }, 'b')).toEqual(row('a', 'b'))
    expect(resizePanes(row('a', 'b'), [], [2, 1])).toEqual({ ...row('a', 'b'), sizes: [2, 1] } as PaneNode)
  })

  test('the old column list becomes the same grid', () => {
    expect(panesFromColumns(['a'])).toBeNull()
    expect(panesFromColumns(['a', 'b'], { a: 2 })).toEqual({ ...row('a', 'b'), sizes: [2, 1] } as PaneNode)
    expect(panesFromColumns(['a', 'b', 'c'])).toEqual({ split: 'column', children: [row('a', 'b'), { leaf: 'c' }], sizes: [1, 1] })
  })

  test('only a well-formed tree is read back', () => {
    expect(readPaneTree(row('a', 'b'))).toEqual(row('a', 'b'))
    expect(readPaneTree({ leaf: 'a' })).toBeNull()
    expect(readPaneTree({ split: 'row', children: [{ leaf: 'a' }], sizes: [1] })).toBeNull()
    expect(readPaneTree('nope')).toBeNull()
  })
})
