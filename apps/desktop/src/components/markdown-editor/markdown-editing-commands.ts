import { EditorSelection, type EditorState, type StateCommand } from '@codemirror/state'
import { EditorView, type KeyBinding } from '@codemirror/view'
import { syntaxTree } from '@codemirror/language'
import { insertNewlineAndIndent } from '@codemirror/commands'
import { deleteMarkupBackward, insertNewlineContinueMarkupCommand } from '@codemirror/lang-markdown'

// Obsidian's editing helpers on top of lang-markdown's list/quote continuation.

// Enter on an empty item ends the list, as in Obsidian, instead of loosening it.
const continueMarkup = insertNewlineContinueMarkupCommand({ nonTightLists: false })
const LIST_ITEM = /^(\s*)([-*+]|\d+[.)])(\s+)/
const PAIRS: Record<string, string> = { '(': ')', '[': ']', '"': '"', '`': '`' }
const CLOSERS = new Set([')', ']'])

function inCode(state: EditorState, pos: number): boolean {
  for (let node: ReturnType<typeof syntaxTree>['topNode'] | null = syntaxTree(state).resolveInner(pos, -1); node; node = node.parent) {
    if (node.name === 'FencedCode' || node.name === 'CodeBlock' || node.name === 'InlineCode') return true
  }
  return false
}

/** Where a nested item's text must start to stay inside the item above it. */
function nestWidth(state: EditorState, lineNumber: number, indent: number): number {
  for (let n = lineNumber - 1; n >= 1; n--) {
    const text = state.doc.line(n).text
    if (!text.trim()) continue
    const match = LIST_ITEM.exec(text)
    if (!match) return 2
    const ownIndent = match[1]!.length
    if (ownIndent <= indent) return ownIndent + match[2]!.length + match[3]!.length - indent
  }
  return 2
}

function parentIndent(state: EditorState, lineNumber: number, indent: number): number {
  for (let n = lineNumber - 1; n >= 1; n--) {
    const match = LIST_ITEM.exec(state.doc.line(n).text)
    if (match && match[1]!.length < indent) return match[1]!.length
  }
  return Math.max(0, indent - 2)
}

function selectedListLines(state: EditorState): number[] | null {
  const lines = new Set<number>()
  for (const range of state.selection.ranges) {
    for (let n = state.doc.lineAt(range.from).number; n <= state.doc.lineAt(range.to).number; n++) lines.add(n)
  }
  const list = [...lines].filter((n) => LIST_ITEM.test(state.doc.line(n).text))
  return list.length > 0 && list.length === lines.size ? list : null
}

/** Tab nests the selected list items one level under the item above. */
export const indentListItem: StateCommand = ({ state, dispatch }) => {
  const lines = selectedListLines(state)
  if (!lines) return false
  const changes = lines.map((n) => {
    const line = state.doc.line(n)
    const indent = LIST_ITEM.exec(line.text)![1]!.length
    return { from: line.from, insert: ' '.repeat(Math.max(1, nestWidth(state, n, indent))) }
  })
  dispatch(state.update({ changes, userEvent: 'input.indent' }))
  return true
}

/** Shift+Tab lifts the selected list items to their parent's level. */
export const outdentListItem: StateCommand = ({ state, dispatch }) => {
  const lines = selectedListLines(state)
  if (!lines) return false
  const changes = lines.flatMap((n) => {
    const line = state.doc.line(n)
    const indent = LIST_ITEM.exec(line.text)![1]!.length
    if (indent === 0) return []
    return [{ from: line.from, to: line.from + indent - parentIndent(state, n, indent) }]
  })
  if (changes.length > 0) dispatch(state.update({ changes, userEvent: 'delete.dedent' }))
  return true
}

/** Inside a code block Tab indents instead of leaving the editor. */
const indentCode: StateCommand = ({ state, dispatch }) => {
  if (!state.selection.ranges.every((r) => inCode(state, r.head))) return false
  dispatch(state.update(state.replaceSelection('  '), { scrollIntoView: true, userEvent: 'input' }))
  return true
}

function toggleWrap(marker: string): StateCommand {
  return ({ state, dispatch }) => {
    const changes = state.changeByRange((range) => {
      const before = state.sliceDoc(range.from - marker.length, range.from)
      const after = state.sliceDoc(range.to, range.to + marker.length)
      if (before === marker && after === marker) {
        return {
          changes: [
            { from: range.from - marker.length, to: range.from },
            { from: range.to, to: range.to + marker.length }
          ],
          range: EditorSelection.range(range.from - marker.length, range.to - marker.length)
        }
      }
      return {
        changes: [
          { from: range.from, insert: marker },
          { from: range.to, insert: marker }
        ],
        range: EditorSelection.range(range.from + marker.length, range.to + marker.length)
      }
    })
    dispatch(state.update(changes, { scrollIntoView: true, userEvent: 'input' }))
    return true
  }
}

/** Backspace between an empty auto-closed pair removes both halves. */
const deletePair: StateCommand = ({ state, dispatch }) => {
  if (!state.selection.ranges.every((r) => r.empty)) return false
  const pairAt = (pos: number) => {
    const open = state.sliceDoc(pos - 1, pos)
    if (open === '*' && state.sliceDoc(pos - 2, pos + 2) === '****') return 2
    return PAIRS[open] && PAIRS[open] === state.sliceDoc(pos, pos + 1) ? 1 : 0
  }
  if (!state.selection.ranges.every((r) => pairAt(r.head) > 0)) return false
  const changes = state.changeByRange((range) => {
    const size = pairAt(range.head)
    return {
      changes: { from: range.head - size, to: range.head + size },
      range: EditorSelection.cursor(range.head - size)
    }
  })
  dispatch(state.update(changes, { scrollIntoView: true, userEvent: 'delete.backward' }))
  return true
}

export const markdownEditingKeymap: readonly KeyBinding[] = [
  { key: 'Enter', run: (view) => continueMarkup(view) || insertNewlineAndIndent(view) },
  // Obsidian's soft break: a new line inside the item, without a new marker.
  { key: 'Shift-Enter', run: insertNewlineAndIndent },
  { key: 'Backspace', run: (view) => deletePair(view) || deleteMarkupBackward(view) },
  { key: 'Tab', run: (view) => indentListItem(view) || indentCode(view) },
  { key: 'Shift-Tab', run: outdentListItem },
  { key: 'Mod-b', run: toggleWrap('**') },
  { key: 'Mod-i', run: toggleWrap('*') },
  { key: 'Mod-e', run: toggleWrap('`') }
]

/**
 * Auto-closing ``` ` ** ( [ " ``: typed openers wrap a selection or close themselves before
 * whitespace, closers step over their twin, and a third backtick on an empty line opens a fence.
 */
export const markdownAutoPairs = EditorView.inputHandler.of((view, from, to, text) => {
  if (view.compositionStarted || text.length !== 1) return false
  const { state } = view
  if (state.selection.ranges.length > 1) return false
  const next = state.sliceDoc(to, to + 1)
  const prev = state.sliceDoc(from - 1, from)
  const line = state.doc.lineAt(from)
  const freeAfter = next === '' || /\s/.test(next) || CLOSERS.has(next)

  const apply = (insert: string, anchor: number, head = anchor) => {
    view.dispatch({
      changes: { from, to, insert },
      selection: EditorSelection.range(from + anchor, from + head),
      scrollIntoView: true,
      userEvent: 'input.type'
    })
    return true
  }
  const selected = state.sliceDoc(from, to)

  if (text === '*') {
    if (selected) return apply(`*${selected}*`, 1, 1 + selected.length)
    if (next === '*') return moveOver(view, to)
    // An opening `**` (after a space or at a line start) closes itself, so `**|**` waits for the text.
    if (prev === '*' && /^\s?$/.test(state.sliceDoc(from - 2, from - 1)) && freeAfter && !inCode(state, from)) {
      return apply('***', 1)
    }
    return false
  }
  if (CLOSERS.has(text) && !selected && next === text) return moveOver(view, to)
  const close = PAIRS[text]
  if (!close) return false
  if (selected) return apply(`${text}${selected}${close}`, 1, 1 + selected.length)
  if (text === close && next === text) return moveOver(view, to)
  if (text === '`') {
    const before = state.sliceDoc(line.from, from)
    if (/^\s*``$/.test(before) && state.sliceDoc(to, line.to) === '') {
      const indent = /^\s*/.exec(before)![0]
      return apply(`\`\n${indent}\`\`\``, 1)
    }
    if (inCode(state, from)) return false
  }
  if (!freeAfter || (text === '"' && /\w/.test(prev))) return false
  return apply(`${text}${close}`, 1)
})

function moveOver(view: EditorView, pos: number): boolean {
  view.dispatch({ selection: EditorSelection.cursor(pos + 1), scrollIntoView: true, userEvent: 'select' })
  return true
}
