import { syntaxTree } from '@codemirror/language'
import type { EditorState, Range } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from '@codemirror/view'

// Obsidian-style live preview: the source stays verbatim (prompts must round-trip exactly) while
// decorations style it, and syntax markers hide on every line the caret is not on.

const hide = Decoration.replace({})
const syntaxMark = Decoration.mark({ class: 'cm-md-syntax' })
const MARKS: Record<string, Decoration> = {
  Emphasis: Decoration.mark({ class: 'cm-md-em' }),
  StrongEmphasis: Decoration.mark({ class: 'cm-md-strong' }),
  Strikethrough: Decoration.mark({ class: 'cm-md-strike' }),
  InlineCode: Decoration.mark({ class: 'cm-md-inline-code' }),
  Link: Decoration.mark({ class: 'cm-md-link' }),
  Autolink: Decoration.mark({ class: 'cm-md-link' }),
  CodeInfo: Decoration.mark({ class: 'cm-md-code-info' })
}
/** Markers that vanish off the caret's lines. */
const HIDDEN_MARKS = new Set(['EmphasisMark', 'StrikethroughMark', 'QuoteMark'])
const taskDone = Decoration.mark({ class: 'cm-md-task-done' })

class BulletWidget extends WidgetType {
  eq(): boolean {
    return true
  }
  toDOM(): HTMLElement {
    const span = document.createElement('span')
    span.className = 'cm-md-bullet'
    span.textContent = '•'
    return span
  }
}

class TaskWidget extends WidgetType {
  constructor(readonly checked: boolean) {
    super()
  }
  eq(other: TaskWidget): boolean {
    return other.checked === this.checked
  }
  toDOM(): HTMLElement {
    const box = document.createElement('input')
    box.type = 'checkbox'
    box.checked = this.checked
    box.tabIndex = -1
    box.className = 'cm-md-task-box'
    box.dataset.mdTask = ''
    box.setAttribute('aria-label', this.checked ? 'Completed task' : 'Task')
    return box
  }
  ignoreEvent(): boolean {
    return false
  }
}

const bullet = Decoration.replace({ widget: new BulletWidget() })
const tasks = [Decoration.replace({ widget: new TaskWidget(false) }), Decoration.replace({ widget: new TaskWidget(true) })]

function lineClass(cls: string): Decoration {
  return Decoration.line({ class: cls })
}

/** Lines a selection touches; none while unfocused, so a resting draft reads fully rendered. */
function caretLines(state: EditorState, focused: boolean): Set<number> {
  const lines = new Set<number>()
  if (!focused) return lines
  for (const range of state.selection.ranges) {
    const first = state.doc.lineAt(range.from).number
    const last = state.doc.lineAt(range.to).number
    for (let n = first; n <= last; n++) lines.add(n)
  }
  return lines
}

function touchesSelection(state: EditorState, from: number, to: number): boolean {
  return state.selection.ranges.some((r) => r.from <= to && r.to >= from)
}

function build(view: EditorView): DecorationSet {
  const { state } = view
  const focused = view.hasFocus
  const active = caretLines(state, focused)
  const isActive = (pos: number) => active.has(state.doc.lineAt(pos).number)
  const out: Range<Decoration>[] = []
  const eachLine = (from: number, to: number, deco: (n: number, first: boolean, last: boolean) => Decoration) => {
    const first = state.doc.lineAt(from).number
    const last = state.doc.lineAt(to).number
    for (let n = first; n <= last; n++) out.push(deco(n, n === first, n === last).range(state.doc.line(n).from))
  }
  // Hides a marker plus the one space that separates it from its text.
  const hideWithSpace = (node: { from: number; to: number }) => {
    const end = state.doc.sliceString(node.to, node.to + 1) === ' ' ? node.to + 1 : node.to
    out.push(hide.range(node.from, end))
  }

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(state).iterate({
      from,
      to,
      enter: (node) => {
        const name = node.name
        const heading = /^(?:ATX|Setext)Heading(\d)$/.exec(name)
        if (heading) {
          out.push(lineClass(`cm-md-heading cm-md-h${heading[1]}`).range(state.doc.lineAt(node.from).from))
          return
        }
        if (MARKS[name] && node.from < node.to) out.push(MARKS[name].range(node.from, node.to))
        switch (name) {
          case 'HeaderMark': {
            const parent = node.node.parent
            if (!parent || parent.name.startsWith('Setext') || isActive(node.from)) {
              out.push(syntaxMark.range(node.from, node.to))
            } else if (node.from === parent.from) {
              hideWithSpace(node)
            } else {
              // A closing `##` takes the space before it.
              const start = state.doc.sliceString(node.from - 1, node.from) === ' ' ? node.from - 1 : node.from
              out.push(hide.range(start, node.to))
            }
            return
          }
          case 'CodeMark': {
            const parent = node.node.parent?.name
            if (parent === 'InlineCode' && !isActive(node.from)) out.push(hide.range(node.from, node.to))
            else out.push(syntaxMark.range(node.from, node.to))
            return
          }
          case 'LinkMark':
          case 'URL':
          case 'LinkTitle': {
            const inLink = node.node.parent?.name === 'Link'
            if (inLink && !isActive(node.from)) out.push(hide.range(node.from, node.to))
            else if (name === 'URL' && !inLink) out.push(MARKS.Link!.range(node.from, node.to))
            else out.push(syntaxMark.range(node.from, node.to))
            return
          }
          case 'ListMark': {
            const item = node.node.parent
            const task = item?.getChild('Task')
            const onCaret = isActive(node.from)
            if (task && !onCaret) hideWithSpace(node)
            else if (!onCaret && item?.parent?.name === 'BulletList') out.push(bullet.range(node.from, node.to))
            else out.push(Decoration.mark({ class: 'cm-md-list-mark' }).range(node.from, node.to))
            return
          }
          case 'TaskMarker': {
            const checked = /x/i.test(state.doc.sliceString(node.from, node.to))
            if (!touchesSelection(state, node.from, node.to) || !focused) out.push(tasks[checked ? 1 : 0]!.range(node.from, node.to))
            const task = node.node.parent
            if (checked && task && node.to < task.to) out.push(taskDone.range(node.to, task.to))
            return
          }
          case 'Blockquote':
            eachLine(node.from, node.to, () => lineClass('cm-md-quote'))
            return
          case 'FencedCode':
          case 'CodeBlock':
            eachLine(node.from, node.to, (_n, first, last) =>
              lineClass(`cm-md-codeblock${first ? ' cm-md-codeblock-first' : ''}${last ? ' cm-md-codeblock-last' : ''}`)
            )
            return
          case 'HorizontalRule':
            if (!isActive(node.from)) {
              out.push(lineClass('cm-md-hr').range(state.doc.lineAt(node.from).from))
              out.push(hide.range(node.from, node.to))
            } else out.push(syntaxMark.range(node.from, node.to))
            return
          default:
            if (HIDDEN_MARKS.has(name)) {
              if (isActive(node.from)) out.push(syntaxMark.range(node.from, node.to))
              else if (name === 'QuoteMark') hideWithSpace(node)
              else out.push(hide.range(node.from, node.to))
            }
        }
      }
    })
  }
  return Decoration.set(out, true)
}

function toggleTask(view: EditorView, target: HTMLElement): boolean {
  const pos = view.posAtDOM(target)
  const marker = view.state.doc.sliceString(pos, pos + 3)
  if (!/^\[[ xX]\]$/.test(marker)) return false
  view.dispatch({ changes: { from: pos + 1, to: pos + 2, insert: marker[1] === ' ' ? 'x' : ' ' } })
  return true
}

export const markdownLivePreview = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    constructor(view: EditorView) {
      this.decorations = build(view)
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged || update.selectionSet || update.focusChanged) {
        this.decorations = build(update.view)
      }
    }
  },
  {
    decorations: (plugin) => plugin.decorations,
    eventHandlers: {
      mousedown(event, view) {
        const target = event.target
        if (!(target instanceof HTMLElement) || target.dataset.mdTask === undefined) return false
        event.preventDefault()
        return toggleTask(view, target)
      }
    }
  }
)
