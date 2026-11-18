import { useState } from 'react'
import { ArrowUp, ListPlus, Loader2, Play, Square, X, type LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { SUBMIT_SHORTCUT_LABEL } from '@/lib/terminal-shortcuts'
import { MarkdownEditor, type MarkdownEditorHandle } from '@/components/markdown-editor/MarkdownEditor'
import { chatImageSrc, openChatLightbox } from './ChatLightbox'
import { NativeChatAutocompleteMenu } from './NativeChatAutocompleteMenus'
import type { NativeChatComposerState } from './use-native-chat-composer'
import { t } from '@/i18n/i18n'

// The composer as it is drawn, for an open chat and for the "New chat" tab alike. The box follows
// Orca's NativeChatComposer; what sits where follows T3 Code's composer: attachments as chips
// above the text, the + alone at the footer's left, and at its right the agent and model, the
// permissions, and the round button that sends, queues or stops.

/** How a hint names the key that sends, for each choice of `chatSendKey`. */
export const SEND_LABEL = { 'mod-enter': SUBMIT_SHORTCUT_LABEL, enter: '↵' } as const
// What a press in the composer box keeps for itself instead of moving the caret.
const COMPOSER_CONTROLS = 'button, a, input, select, textarea, label, [role="button"], [role="menuitem"], [role="option"], .cm-content, [data-native-chat-attachment]'

const ACTION_ICON: Record<'send' | 'queue' | 'resume' | 'stop' | 'busy', LucideIcon> = {
  send: ArrowUp,
  queue: ListPlus,
  resume: Play,
  stop: Square,
  busy: Loader2
}

/** The round button at the footer's right end; `hint` is its tooltip (the label when absent). */
export function NativeChatComposerAction({
  kind,
  label,
  hint,
  disabled,
  onClick
}: {
  kind: keyof typeof ACTION_ICON
  label: string
  hint?: string
  disabled?: boolean
  onClick: () => void
}) {
  const Icon = ACTION_ICON[kind]
  const stop = kind === 'stop'
  return (
    // A disabled button gets no pointer events, so the hint hangs on a wrapper.
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex shrink-0">
          <Button
            type="button"
            data-native-chat-critical-action={stop ? 'stop' : undefined}
            data-native-chat-action={kind}
            aria-label={label}
            onMouseDown={(event) => event.preventDefault()}
            onClick={(event) => {
              // A double-click lands after the first send started; it must not stop the new turn.
              if (event.detail > 1) return
              onClick()
            }}
            disabled={disabled || kind === 'busy'}
            variant={stop ? 'secondary' : 'default'}
            size="icon"
            className={cn('size-8 rounded-full', !stop && 'bg-highlight text-white hover:bg-highlight/90')}
          >
            <Icon className={cn(stop ? 'size-3.5 fill-current' : 'size-4', kind === 'resume' && 'fill-current', kind === 'busy' && 'animate-spin')} />
          </Button>
        </span>
      </TooltipTrigger>
      <TooltipContent side="top" sideOffset={4} data-native-chat-send-hint>
        {hint ?? label}
      </TooltipContent>
    </Tooltip>
  )
}

export function NativeChatComposerBox({
  composer,
  editorRef,
  boxRef,
  takesTabDrops,
  placeholder,
  notice,
  left,
  right,
  actions
}: {
  composer: NativeChatComposerState
  editorRef: React.RefObject<MarkdownEditorHandle | null>
  boxRef?: React.Ref<HTMLDivElement>
  /** Tabs and explorer files dragged over the box are the caller's to take (lib/chat-composer-drop.ts). */
  takesTabDrops?: boolean
  placeholder: string
  /** A line above the box: why sending waits. */
  notice?: React.ReactNode
  /** Footer, left: what goes into the message (the +, a workflow, the memo). */
  left: React.ReactNode
  /** Footer, right: what the turn runs with (agent and model, permissions, context). */
  right: React.ReactNode
  /** Footer, right end: the send, queue and stop buttons. */
  actions: React.ReactNode
}) {
  const [dragging, setDragging] = useState(false)
  const { draft, draftImages, autocomplete, selected, optionCount, listboxId, suggestion } = composer
  const images = draftImages.map((image, index) => ({ src: chatImageSrc(image), title: t('Image {n}', { n: index + 1 }) }))

  return (
    <div className="relative w-full">
      {autocomplete ? (
        <NativeChatAutocompleteMenu autocomplete={autocomplete} activeIndex={selected} listboxId={listboxId} onChoose={composer.choose} />
      ) : null}
      {notice}
      <div
        ref={boxRef}
        data-native-chat-composer
        data-chat-composer-drop={takesTabDrops ? '' : undefined}
        data-composer-session={composer.draftId}
        className={cn(
          'cursor-text rounded-2xl border border-chat-composer-border bg-chat-composer-surface p-2 shadow-[0_2px_10px_rgb(0_0_0/0.04)] [contain:paint] data-[tab-drop-hover]:border-ring data-[tab-drop-hover]:ring-2 data-[tab-drop-hover]:ring-ring/30',
          dragging && 'border-ring'
        )}
        onDragOver={(event) => {
          if ([...event.dataTransfer.items].some((i) => i.kind === 'file')) {
            event.preventDefault()
            setDragging(true)
          }
        }}
        // The whole box is the input: a press on its padding, below the text or between the controls
        // puts the caret at the end, as if the text box filled it.
        onMouseDown={(event) => {
          if (event.button !== 0 || !(event.target instanceof HTMLElement)) return
          const target = event.target
          if (target.closest(COMPOSER_CONTROLS)) return
          // A press on a scrollbar scrolls.
          if (event.nativeEvent.offsetX > target.clientWidth || event.nativeEvent.offsetY > target.clientHeight) return
          event.preventDefault()
          editorRef.current?.focusEnd()
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          setDragging(false)
          if (event.dataTransfer.files.length === 0) return
          event.preventDefault()
          void composer.addImages(event.dataTransfer.files)
        }}
      >
        {draftImages.length > 0 ? (
          <div className="flex flex-wrap gap-1.5 px-1 pt-1 pb-1.5" aria-label={t('Attachments')}>
            {images.map((image, index) => (
              <span
                key={index}
                data-native-chat-attachment
                className="inline-flex h-8 max-w-48 cursor-default items-center gap-1.5 rounded-lg border border-border bg-chat-canvas py-0.5 pr-1 pl-0.5 text-xs text-chat-foreground"
              >
                <button
                  type="button"
                  aria-label={t('View image {n}', { n: index + 1 })}
                  onClick={() => openChatLightbox(images, index)}
                  className="flex min-w-0 items-center gap-1.5 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <img src={image.src} alt="" className="size-6.5 shrink-0 rounded-md bg-chat-composer-surface object-cover" />
                  <span className="truncate">{image.title}</span>
                </button>
                <button
                  type="button"
                  aria-label={t('Remove image')}
                  onClick={() => composer.removeImage(index)}
                  className="flex size-5 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors outline-none hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <X className="size-3" />
                </button>
              </span>
            ))}
          </div>
        ) : null}
        <MarkdownEditor
          ref={editorRef}
          value={draft}
          placeholder={placeholder}
          contentAttributes={{
            'aria-label': t('Message the agent'),
            'aria-multiline': 'true',
            role: 'combobox',
            'aria-expanded': String(autocomplete !== null),
            'aria-controls': autocomplete ? listboxId : undefined,
            'aria-activedescendant': autocomplete && optionCount > 0 ? `${listboxId}-option-${selected}` : undefined,
            'data-native-chat-input': '',
            'aria-description': suggestion ? t('Suggestion: {suggestion}. Press Tab to use it.', { suggestion }) : undefined
          }}
          onChange={(value) => {
            composer.setDraft(value)
            composer.resetActiveIndex()
          }}
          onCaretChange={composer.setCaret}
          onKeyDown={composer.handleKeyDown}
          onPasteFiles={composer.pasteFiles}
          minHeight="3rem"
          maxHeight="calc(12lh + 0.5rem)"
          className="px-2 py-1 text-sm text-chat-foreground-strong"
        />
        <input
          ref={composer.fileInput}
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files) void composer.addImages(e.target.files)
            e.target.value = ''
          }}
        />
        {/* One line at any width: the mode and model names shorten instead of wrapping. */}
        <div className="flex w-full min-w-0 items-center gap-x-2 pt-0.5 text-chat-foreground-faint" data-native-chat-composer-footer>
          <div className="flex shrink-0 items-center gap-0.5">{left}</div>
          <div className="ml-auto flex min-w-0 shrink items-center justify-end gap-1">
            {right}
            {actions}
          </div>
        </div>
      </div>
    </div>
  )
}
