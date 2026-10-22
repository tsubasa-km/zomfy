import { RangeSetBuilder } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from '@codemirror/view'
import { TERMINAL_ICON_SVG, findTerminalOutputMentions } from '@/lib/terminal-output-mention'

class TerminalOutputChip extends WidgetType {
  constructor(readonly label: string) {
    super()
  }

  eq(other: TerminalOutputChip): boolean {
    return other.label === this.label
  }

  toDOM(): HTMLElement {
    const chip = document.createElement('span')
    chip.className = 'cm-terminal-output-chip'
    chip.title = 'Command output, attached to this message'
    chip.innerHTML = TERMINAL_ICON_SVG
    chip.append(document.createTextNode(this.label))
    return chip
  }
}

function build(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>()
  for (const { from, to } of view.visibleRanges) {
    const text = view.state.doc.sliceString(from, to)
    for (const match of findTerminalOutputMentions(text)) {
      builder.add(from + match.from, from + match.to, Decoration.replace({ widget: new TerminalOutputChip(match.label) }))
    }
  }
  return builder.finish()
}

/** Shows a Run's attached output as one chip that the caret and Backspace treat as a single character. */
export const terminalOutputChips = [
  ViewPlugin.fromClass(
    class {
      decorations: DecorationSet
      constructor(view: EditorView) {
        this.decorations = build(view)
      }
      update(update: ViewUpdate) {
        if (update.docChanged || update.viewportChanged) this.decorations = build(update.view)
      }
    },
    {
      decorations: (plugin) => plugin.decorations,
      provide: (plugin) => EditorView.atomicRanges.of((view) => view.plugin(plugin)?.decorations ?? Decoration.none)
    }
  )
]
