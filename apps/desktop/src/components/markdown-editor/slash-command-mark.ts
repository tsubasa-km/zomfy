import { Facet, type Extension } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view'

/** The command names the agent knows; a message starting with `/` and one of them runs it. */
export const slashCommandNames = Facet.define<readonly string[], ReadonlySet<string>>({
  combine: (values) => new Set(values.flat())
})

/** The `/name` a message starts with, when it names a known command: [0, end). */
export function slashCommandEnd(text: string, names: ReadonlySet<string>): number | null {
  const match = /^\/(\S+)(?=\s|$)/.exec(text)
  return match && names.has(match[1]!) ? match[0].length : null
}

const mark = Decoration.mark({ class: 'md-slash-command' })

function build(view: EditorView): DecorationSet {
  const head = view.state.doc.sliceString(0, Math.min(view.state.doc.length, 200))
  const end = slashCommandEnd(head, view.state.facet(slashCommandNames))
  return end === null ? Decoration.none : Decoration.set([mark.range(0, end)])
}

/** Draws a leading `/command` in color once it names a command the agent has. */
export const slashCommandMark: Extension = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet
    constructor(view: EditorView) {
      this.decorations = build(view)
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.startState.facet(slashCommandNames) !== update.state.facet(slashCommandNames)) {
        this.decorations = build(update.view)
      }
    }
  },
  { decorations: (plugin) => plugin.decorations }
)
