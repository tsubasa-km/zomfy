import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import type { ChatCommand } from '@zomfy/protocol'
import type { MarkdownEditorHandle } from '@/components/markdown-editor/MarkdownEditor'
import { appendToDraft, loadMentionFiles } from '@/chat-actions'
import { imageTypeOf, readDroppedImage } from '@/lib/chat-file-drop'
import { hostDropPath, registerComposerDropTarget } from '@/lib/terminal-file-drop'
import { isSubmitShortcut } from '@/lib/terminal-shortcuts'
import type { ChatImage, HostId } from '@/session-store'
import { patchChatSession, useChatSession, useChatStore } from '@/stores/chat-store'
import { useSetting } from '@/stores/settings-store'
import { composerAutocompleteQuery, matchCommands, matchFiles, type ComposerAutocomplete } from './NativeChatAutocompleteMenus'
import { recallStep, type RecalledPrompt } from './native-chat-prompt-recall'

// What every composer does with its text box, whether a chat is behind it or (the "New thread" tab)
// none yet: the draft and its images, the `/` and `@` menus, the keys, pasted and dropped files.
// NativeChatComposerBox draws it; the caller says what sending does.

const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])

function readImage(file: File): Promise<ChatImage | null> {
  if (!IMAGE_TYPES.has(file.type)) return Promise.resolve(null)
  return new Promise((resolve) => {
    const reader = new FileReader()
    reader.onload = () => {
      const url = typeof reader.result === 'string' ? reader.result : ''
      const comma = url.indexOf(',')
      resolve(comma === -1 ? null : { mimeType: file.type, data: url.slice(comma + 1) })
    }
    reader.onerror = () => resolve(null)
    reader.readAsDataURL(file)
  })
}

export interface ComposerSource {
  /** The chat-store entry holding the draft: a session's id, or the "New chat" tab's own. */
  draftId: string
  /** The host the message goes to: dropped files' paths are written in its form. */
  hostId: HostId
  editorRef: React.RefObject<MarkdownEditorHandle | null>
  /** The `/` menu's commands; null leaves the menu out. */
  commands: { items: ChatCommand[]; status: 'loading' | 'ready' | 'error' } | null
  /** The workspace whose files the `@` menu lists; null leaves the menu out. */
  filesWorkspaceId: string | null
  /** A guess at the next prompt, offered while the composer is empty; Tab takes it. */
  suggestion: string | null
  /** The prompts sent here so far, oldest first, read when ArrowUp asks for one. */
  history: () => readonly string[]
  onSubmit: () => void
}

export type NativeChatComposerState = ReturnType<typeof useNativeChatComposer>

export function useNativeChatComposer({ draftId, hostId, editorRef, commands, filesWorkspaceId, suggestion: offered, history, onSubmit }: ComposerSource) {
  const { draft, draftImages } = useChatSession(draftId)
  const files = useChatStore((s) => (filesWorkspaceId ? s.mentionFiles[filesWorkspaceId] : undefined))
  const listboxId = useId()
  const fileInput = useRef<HTMLInputElement>(null)
  const [caret, setCaret] = useState(0)
  const [activeIndex, setActiveIndex] = useState(0)
  const [dismissedAt, setDismissedAt] = useState<string | null>(null)
  const sendKey = useSetting('chatSendKey')
  const recalled = useRef<RecalledPrompt | null>(null)

  const found = composerAutocompleteQuery(draft, caret)
  const query = found && (found.mode === 'slash' ? commands !== null : filesWorkspaceId !== null) ? found : null
  useEffect(() => {
    if (query?.mode === 'mention' && !files && filesWorkspaceId) void loadMentionFiles(filesWorkspaceId)
  }, [query?.mode, files, filesWorkspaceId])

  const autocomplete = useMemo((): ComposerAutocomplete | null => {
    if (!query || dismissedAt === draft) return null
    if (query.mode === 'slash') {
      return { ...query, mode: 'slash', items: matchCommands(commands?.items ?? [], query.query), status: commands?.status ?? 'loading' }
    }
    return { ...query, mode: 'mention', items: matchFiles(files?.value ?? [], query.query), status: files?.status ?? 'loading' }
  }, [query?.mode, query?.query, query?.start, query?.end, commands?.items, commands?.status, files, dismissedAt, draft])
  // The names a leading `/command` is drawn in color for, once it names one of them.
  const commandNames = useMemo(() => commands?.items.map((c) => c.name) ?? [], [commands?.items])
  const optionCount = autocomplete?.items.length ?? 0
  const selected = Math.min(activeIndex, Math.max(0, optionCount - 1))
  // Tab takes the guess, as in the Claude apps.
  const suggestion = draft === '' && draftImages.length === 0 ? offered : null

  function setDraft(value: string) {
    patchChatSession(draftId, { draft: value })
  }

  function clear() {
    patchChatSession(draftId, { draft: '', draftImages: [] })
    setCaret(0)
  }

  function choose(index: number) {
    if (!autocomplete) return
    const insert =
      autocomplete.mode === 'slash'
        ? `/${autocomplete.items[index]?.name ?? autocomplete.query} `
        : `@${autocomplete.items[index] ?? autocomplete.query} `
    setActiveIndex(0)
    editorRef.current?.replaceRange(autocomplete.start, autocomplete.end, insert)
  }

  /** The chosen Enter sends; with Enter chosen, Cmd/Ctrl+Enter sends too. */
  function isSendKey(e: KeyboardEvent): boolean {
    if (e.key !== 'Enter' || e.shiftKey || e.altKey) return false
    if (isSubmitShortcut(e)) return true
    return sendKey === 'enter' && !e.ctrlKey && !e.metaKey
  }

  /** An arrow key walking the prompts sent here (native-chat-prompt-recall.ts); a composer holding an image is not empty. */
  function recall(e: KeyboardEvent): boolean {
    if ((e.key !== 'ArrowUp' && e.key !== 'ArrowDown') || e.shiftKey || e.altKey || e.ctrlKey || e.metaKey || draftImages.length > 0) return false
    const step = recallStep(e.key, draft, caret, recalled.current, history())
    if (step === null) return false
    if (step !== 'hold') {
      recalled.current = step.recalled
      editorRef.current?.replaceRange(0, draft.length, step.text)
    }
    return true
  }

  function handleKeyDown(e: KeyboardEvent): boolean {
    if (suggestion && e.key === 'Tab' && !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey) {
      editorRef.current?.replaceRange(0, 0, suggestion)
      return true
    }
    if (autocomplete && optionCount > 0) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        const step = e.key === 'ArrowDown' ? 1 : -1
        setActiveIndex((selected + step + optionCount) % optionCount)
        return true
      }
      const plainEnter = e.key === 'Enter' && !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey
      if (e.key === 'Tab' || plainEnter) {
        // With Enter sending, a fully typed command sends on Enter; Tab always completes.
        const exact = autocomplete.mode === 'slash' && autocomplete.items[selected]?.name === autocomplete.query
        if (e.key === 'Tab' || !exact || sendKey !== 'enter') {
          choose(selected)
          return true
        }
      }
    }
    if (autocomplete && e.key === 'Escape') {
      setDismissedAt(draft)
      return true
    }
    if (recall(e)) return true
    if (isSendKey(e)) {
      onSubmit()
      return true
    }
    return false
  }

  /** Opens the @ file menu at the caret, as typing @ would. */
  function startFileMention() {
    const before = draft.slice(0, caret)
    editorRef.current?.replaceRange(caret, caret, before === '' || /\s$/.test(before) ? '@' : ' @')
  }

  async function addImages(list: Iterable<File>) {
    const images = (await Promise.all([...list].map(readImage))).filter((i): i is ChatImage => i !== null)
    if (images.length > 0) patchChatSession(draftId, (c) => ({ draftImages: [...c.draftImages, ...images] }))
  }

  function removeImage(index: number) {
    patchChatSession(draftId, (c) => ({ draftImages: c.draftImages.filter((_, i) => i !== index) }))
  }

  /** Pasted files: images attach (true: the editor then inserts nothing). */
  function pasteFiles(pasted: File[]): boolean {
    const images = pasted.filter((f) => IMAGE_TYPES.has(f.type))
    if (images.length === 0) return false
    void addImages(images)
    return true
  }

  // Files dropped from the OS come as paths (the page never sees the drop): images attach, other
  // files go in as their paths, in the form the chat's host uses.
  const dropRef = useRef<(paths: string[]) => void>(() => {})
  dropRef.current = (paths) => {
    const images = paths.filter((p) => imageTypeOf(p) !== null)
    const others = paths.filter((p) => imageTypeOf(p) === null)
    if (others.length > 0) appendToDraft(draftId, others.map((p) => hostDropPath(p, hostId)).join(' '))
    for (const path of images) {
      readDroppedImage(path).then(
        (image) => patchChatSession(draftId, (c) => ({ draftImages: [...c.draftImages, image] })),
        (error: unknown) => toast.error(error instanceof Error ? error.message : String(error))
      )
    }
    editorRef.current?.focusEnd()
  }
  useEffect(() => registerComposerDropTarget(draftId, (paths) => dropRef.current(paths)), [draftId])

  return {
    draftId,
    draft,
    draftImages,
    caret,
    setCaret,
    sendKey,
    suggestion,
    autocomplete,
    selected,
    optionCount,
    listboxId,
    fileInput,
    setDraft,
    clear,
    choose,
    handleKeyDown,
    resetActiveIndex: () => setActiveIndex(0),
    startFileMention,
    pickImages: () => fileInput.current?.click(),
    addImages,
    removeImage,
    pasteFiles,
    commandNames
  }
}
