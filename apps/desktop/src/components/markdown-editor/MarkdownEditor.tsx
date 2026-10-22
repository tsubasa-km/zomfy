import { useEffect, useImperativeHandle, useLayoutEffect, useRef, type CSSProperties, type Ref } from 'react'
import { Annotation, Compartment, EditorSelection, EditorState } from '@codemirror/state'
import { EditorView, keymap, placeholder as placeholderExtension } from '@codemirror/view'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { languages } from '@codemirror/language-data'
import { cn } from '@/lib/utils'
import {
  createImeEnterGestureOwnership,
  isImeOwnedKeyboardEvent,
  type ImeEnterGestureEvent
} from '@/lib/ime-composition-keyboard-event'
import { markdownLivePreview } from './markdown-live-preview'
import { markdownAutoPairs, markdownEditingKeymap } from './markdown-editing-commands'
import { codeHighlighting } from './markdown-code-highlight'
import { chatMentionChips } from './chat-mention-chips'
import './markdown-editor.css'

// A CodeMirror 6 markdown source editor with Obsidian-style live preview, shared by the chat
// composer and chat memos. The text stays byte-for-byte what the user typed.

export interface MarkdownEditorHandle {
  focus(): void
  getValue(): string
  /** Replaces [from, to) and leaves the caret after the inserted text. */
  replaceRange(from: number, to: number, insert: string): void
}

export interface MarkdownEditorProps {
  value: string
  onChange: (value: string) => void
  onCaretChange?: (caret: number) => void
  placeholder?: string
  /** Attributes for the editable element (aria-label, combobox wiring). */
  contentAttributes?: Record<string, string | undefined>
  /** Runs before the editor's own keys; true consumes the key. IME-owned keys never reach it. */
  onKeyDown?: (event: KeyboardEvent) => boolean
  /** Pasted files; true when taken (the editor then inserts nothing). */
  onPasteFiles?: (files: File[]) => boolean
  minHeight?: string
  maxHeight?: string
  className?: string
  ref?: Ref<MarkdownEditorHandle>
}

/** Marks dispatches that mirror the `value` prop, so they are not echoed back through onChange. */
const fromProp = Annotation.define<boolean>()

function definedAttributes(attrs: Record<string, string | undefined> | undefined): Record<string, string> {
  return Object.fromEntries(Object.entries(attrs ?? {}).filter((e): e is [string, string] => e[1] !== undefined))
}

export function MarkdownEditor({
  value,
  onChange,
  onCaretChange,
  placeholder,
  contentAttributes,
  onKeyDown,
  onPasteFiles,
  minHeight,
  maxHeight,
  className,
  ref
}: MarkdownEditorProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const latest = useRef({ onChange, onCaretChange, onKeyDown, onPasteFiles })
  latest.current = { onChange, onCaretChange, onKeyDown, onPasteFiles }
  const compartments = useRef({ placeholder: new Compartment(), attributes: new Compartment() })

  useLayoutEffect(() => {
    const host = hostRef.current
    if (!host) return
    const ime = createImeEnterGestureOwnership()
    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: value,
        selection: EditorSelection.cursor(value.length),
        extensions: [
          // First, so it runs ahead of every keymap: IME keys and the composer's own chords.
          EditorView.domEventHandlers({
            compositionstart: () => {
              ime.setComposing(true)
              return false
            },
            compositionend: () => {
              ime.onCompositionEnd()
              return false
            },
            keyup: (event) => {
              ime.onKeyUp(gestureOf(event))
              return false
            },
            blur: () => {
              ime.reset()
              return false
            },
            keydown: (event, editor) => {
              // The redispatched Enter that confirmed a conversion is swallowed, not a newline or a send.
              if (ime.ownsKeyDown(gestureOf(event))) return event.key === 'Enter' && !isImeOwnedKeyboardEvent(event)
              if (ime.isComposing() || editor.composing || isImeOwnedKeyboardEvent(event)) return false
              return latest.current.onKeyDown?.(event) ?? false
            },
            paste: (event) => {
              const files = [...(event.clipboardData?.files ?? [])]
              return files.length > 0 && (latest.current.onPasteFiles?.(files) ?? false)
            },
            // Dropped files belong to the surrounding drop zone; CodeMirror would insert them as text.
            drop: (event) => (event.dataTransfer?.files.length ?? 0) > 0
          }),
          history(),
          markdown({ base: markdownLanguage, codeLanguages: languages, addKeymap: false, completeHTMLTags: false }),
          keymap.of([...markdownEditingKeymap, ...historyKeymap, ...defaultKeymap]),
          markdownAutoPairs,
          markdownLivePreview,
          codeHighlighting,
          chatMentionChips,
          EditorView.lineWrapping,
          compartments.current.placeholder.of(placeholder ? placeholderExtension(placeholder) : []),
          compartments.current.attributes.of(EditorView.contentAttributes.of(definedAttributes(contentAttributes))),
          EditorView.updateListener.of((update) => {
            if (update.docChanged && !update.transactions.some((tr) => tr.annotation(fromProp))) {
              latest.current.onChange(update.state.doc.toString())
            }
            if (update.selectionSet || update.docChanged) latest.current.onCaretChange?.(update.state.selection.main.head)
          })
        ]
      })
    })
    view.scrollDOM.classList.add('scrollbar-sleek')
    viewRef.current = view
    return () => {
      view.destroy()
      viewRef.current = null
    }
    // The view is created once; later prop changes flow in through the effects below.
  }, [])

  useLayoutEffect(() => {
    const view = viewRef.current
    if (!view) return
    const current = view.state.doc.toString()
    if (current === value) return
    // Restored, quoted, cleared or dictated text from outside: the caret goes to its end.
    view.dispatch({
      changes: { from: 0, to: current.length, insert: value },
      selection: EditorSelection.cursor(value.length),
      annotations: fromProp.of(true),
      scrollIntoView: true
    })
  }, [value])

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: compartments.current.placeholder.reconfigure(placeholder ? placeholderExtension(placeholder) : [])
    })
  }, [placeholder])

  const attributesKey = JSON.stringify(contentAttributes ?? {})
  useEffect(() => {
    viewRef.current?.dispatch({
      effects: compartments.current.attributes.reconfigure(EditorView.contentAttributes.of(definedAttributes(contentAttributes)))
    })
    // Keyed on the serialized attributes: callers pass a fresh object each render.
  }, [attributesKey])

  useImperativeHandle(
    ref,
    () => ({
      focus: () => viewRef.current?.focus(),
      getValue: () => viewRef.current?.state.doc.toString() ?? value,
      replaceRange: (from, to, insert) => {
        const view = viewRef.current
        if (!view) return
        view.dispatch({
          changes: { from, to, insert },
          selection: EditorSelection.cursor(from + insert.length),
          scrollIntoView: true,
          userEvent: 'input.complete'
        })
        view.focus()
      }
    }),
    [value]
  )

  const style: CSSProperties & Record<'--md-editor-min-height' | '--md-editor-max-height', string | undefined> = {
    '--md-editor-min-height': minHeight,
    '--md-editor-max-height': maxHeight
  }
  return <div ref={hostRef} className={cn('md-editor select-text', className)} style={style} />
}

/** The shape the shared IME tracker reads, built from a native event. */
function gestureOf(event: KeyboardEvent): ImeEnterGestureEvent {
  const { key, keyCode, shiftKey, altKey, ctrlKey, metaKey } = event
  return { key, keyCode, shiftKey, altKey, ctrlKey, metaKey, nativeEvent: event, preventDefault: () => event.preventDefault() }
}
