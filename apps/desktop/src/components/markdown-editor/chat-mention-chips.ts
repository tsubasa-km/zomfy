import { RangeSetBuilder } from '@codemirror/state'
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from '@codemirror/view'
import { MENTION_ICON_SVG, MENTION_TITLE, parseChatMentions, type ChatMention } from '@/lib/chat-mentions'
import { openChatMention } from '@/lib/chat-attachments'

class MentionChip extends WidgetType {
  constructor(readonly mention: ChatMention) {
    super()
  }

  eq(other: MentionChip): boolean {
    return other.mention.path === this.mention.path && other.mention.kind === this.mention.kind
  }

  toDOM(): HTMLElement {
    const chip = document.createElement('span')
    chip.className = 'chat-mention-chip'
    chip.dataset.mentionKind = this.mention.kind
    chip.title = `${MENTION_TITLE[this.mention.kind]}: click to open`
    chip.innerHTML = MENTION_ICON_SVG[this.mention.kind]
    const label = document.createElement('span')
    label.textContent = this.mention.label
    chip.append(label)
    chip.addEventListener('mousedown', (event) => {
      // Opening, not placing the caret; the chat's workspace comes from the surrounding chat view.
      event.preventDefault()
      const workspaceId = chip.closest<HTMLElement>('[data-link-workspace-id]')?.dataset.linkWorkspaceId ?? null
      openChatMention(this.mention, workspaceId)
    })
    return chip
  }

  ignoreEvent(): boolean {
    return true
  }
}

function build(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>()
  for (const { from, to } of view.visibleRanges) {
    for (const mention of parseChatMentions(view.state.doc.sliceString(from, to))) {
      builder.add(from + mention.from, from + mention.to, Decoration.replace({ widget: new MentionChip(mention) }))
    }
  }
  return builder.finish()
}

/** Draws mentions as chips that open what they name; the caret and Backspace treat one as a unit. */
export const chatMentionChips = [
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
