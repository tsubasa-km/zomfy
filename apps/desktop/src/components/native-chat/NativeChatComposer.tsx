import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { ArrowUp, Square, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import type { ChatImage, Session } from '@/session-store'
import { patchChatSession, useChatSession, useChatStore } from '@/stores/chat-store'
import {
  isWorking,
  loadCatalog,
  loadMentionFiles,
  setAgentOption,
  setSessionOptions,
  stopTurn,
  submitPrompt
} from '@/chat-actions'
import {
  NativeChatAutocompleteMenu,
  composerAutocompleteQuery,
  matchCommands,
  matchFiles,
  type ComposerAutocomplete
} from './NativeChatAutocompleteMenus'
import { NativeChatPermissionModePicker } from './NativeChatPermissionModePicker'
import { NativeChatSessionOptionPicker } from './NativeChatSessionOptionPicker'
import { NativeChatContextUsageRing } from './NativeChatContextUsageRing'
import { NativeChatDictationButton } from './NativeChatDictationButton'
import { NativeChatAgentModePicker, NativeChatAgentModelPicker, agentOptionSlots } from './NativeChatAgentOptionPickers'
import { isExternalAgentSession } from '@/lib/chat-agents'
import { isSubmitShortcut, SUBMIT_SHORTCUT_LABEL } from '@/lib/terminal-shortcuts'
import { useSetting } from '@/stores/settings-store'
import { MarkdownEditor, type MarkdownEditorHandle } from '@/components/markdown-editor/MarkdownEditor'
import { loadChatMemo, setChatMemoOpen, useChatMemo } from '@/stores/chat-memo-store'
import { NativeChatMemoButton, NativeChatMemoPanel } from './NativeChatMemoPanel'
import { NativeChatAttachMenu } from './NativeChatAttachMenu'
import { attachChat, attachTerminal, mentionFile } from '@/lib/chat-attachments'
import { NativeChatWorkflowPicker, type WorkflowHome } from './NativeChatWorkflowPicker'
import { toast } from 'sonner'
import { HARNESS_METHODS } from '@acp-harness/protocol'
import { harnessRequest } from '@/daemon-connection'
import { projectOfSession } from '@/lib/session-project'
import { linkOf } from '@/stores/project-links-store'
import { upsertWorkflowRun } from '@/stores/workflow-runs-store'
import { confirmWorkflowStart } from '@/components/workflows/WorkflowStartConfirm'
import { allWorkspaces, getState, hostLabel, useStore } from '@/session-store'
import { t } from '@/i18n/i18n'

// Layout and classes follow Orca's NativeChatComposer, NativeChatComposerField and
// NativeChatComposerActions.

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

const SEND_LABEL = { 'mod-enter': SUBMIT_SHORTCUT_LABEL, enter: '↵' } as const

export function NativeChatComposer({
  session,
  editorRef
}: {
  session: Session
  editorRef: React.RefObject<MarkdownEditorHandle | null>
}) {
  const { draft, draftImages, usage } = useChatSession(session.id)
  const catalog = useChatStore((s) => s.catalogs[session.workspaceId])
  // Models are the account's, not the folder's: when this folder's probe failed, another folder's list on the host serves.
  const hostWorkspaces = useStore((s) => allWorkspaces(s).filter((w) => w.hostId === session.hostId).map((w) => w.id).join(','))
  const fallbackModels = useChatStore(
    (s) =>
      hostWorkspaces
        .split(',')
        .map((id) => s.catalogs[id]?.value?.models)
        .find((m) => m && m.length > 0) ??
      Object.values(s.catalogs)
        .map((c) => c.value?.models)
        .find((m) => m && m.length > 0) ??
      null
  )
  const files = useChatStore((s) => s.mentionFiles[session.workspaceId])
  const working = isWorking(session)
  // Sending or stopping needs the host; while it reconnects the person can still write.
  const offline = useStore((s) => s.hosts[session.hostId]?.connection.kind !== 'connected')
  // Other agents bring their own commands and options over ACP; the workspace catalog is Claude's.
  const external = isExternalAgentSession(session)
  const agentState = session.agentState
  const listboxId = useId()
  const fileInput = useRef<HTMLInputElement>(null)
  const composerBox = useRef<HTMLDivElement>(null)
  const [caret, setCaret] = useState(0)
  const [activeIndex, setActiveIndex] = useState(0)
  const [dismissedAt, setDismissedAt] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const sendKey = useSetting('chatSendKey')
  const [workflow, setWorkflow] = useState<{ id: string; name: string } | null>(null)
  // Workflows are saved with the project's main member, which may be on another host.
  const chatProject = projectOfSession(session)
  const mainMember = chatProject ? (linkOf({ hostId: chatProject.hostId, projectId: chatProject.id })?.members[0] ?? null) : null
  const workflowHome: WorkflowHome = {
    hostId: mainMember?.hostId ?? session.hostId,
    projectId: mainMember?.projectId ?? chatProject?.id ?? null,
    projectName: chatProject ? (chatProject.displayName ?? chatProject.name) : ''
  }
  // Memos belong to main chats; a side chat's notes would be the main chat's.
  const memos = useSetting('chatMemosEnabled') && !session.sideOf
  const memoOpen = useChatMemo(session.id)?.open === true
  useEffect(() => {
    if (memos) loadChatMemo(session.id)
  }, [memos, session.id])

  useEffect(() => {
    if (!external) void loadCatalog(session.workspaceId)
  }, [session.workspaceId, external])

  const query = composerAutocompleteQuery(draft, caret)
  useEffect(() => {
    if (query?.mode === 'mention' && !files) void loadMentionFiles(session.workspaceId)
  }, [query?.mode, files, session.workspaceId])

  const autocomplete = useMemo((): ComposerAutocomplete | null => {
    if (!query || dismissedAt === draft) return null
    if (query.mode === 'slash') {
      return {
        ...query,
        mode: 'slash',
        items: matchCommands(external ? (agentState?.commands ?? []) : (catalog?.value?.commands ?? []), query.query),
        status: external ? (agentState?.phase === 'starting' ? 'loading' : 'ready') : (catalog?.status ?? 'loading')
      }
    }
    return { ...query, mode: 'mention', items: matchFiles(files?.value ?? [], query.query), status: files?.status ?? 'loading' }
  }, [query?.mode, query?.query, query?.start, query?.end, catalog, files, dismissedAt, draft, external, agentState])
  const optionCount = autocomplete?.items.length ?? 0
  // Claude's guess at the next prompt shows in the empty composer; Tab takes it, as in the Claude apps.
  const suggestion = !working && draft === '' && draftImages.length === 0 ? (session.promptSuggestion ?? null) : null
  const selected = Math.min(activeIndex, Math.max(0, optionCount - 1))

  function setDraft(value: string) {
    patchChatSession(session.id, { draft: value })
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
    if (isSendKey(e)) {
      submit()
      return true
    }
    return false
  }

  function submit() {
    if (offline || (!draft.trim() && draftImages.length === 0)) return
    if (workflow && workflowHome.projectId) {
      // The message is the run's task; the harness runs the workflow, not this chat.
      const task = draft.trim()
      if (!task) return
      const projectId = workflowHome.projectId
      const hostId = workflowHome.hostId
      const workflowId = workflow.id
      // The draft stays until the run starts, so a declined start loses nothing.
      void confirmWorkflowStart(hostId, projectId, workflowId, task, 'you')
        .then(async (start) => {
          if (!start) return
          const run = await harnessRequest(
            HARNESS_METHODS.workflowRunStart,
            { projectId, workflowId, task, ...(session.hostId === hostId ? { originSessionId: session.id } : {}) },
            hostId
          )
          upsertWorkflowRun(hostId, run)
          setWorkflow(null)
          patchChatSession(session.id, { draft: '', draftImages: [] })
          setCaret(0)
        })
        .catch((error: unknown) =>
          toast.error(t('The workflow did not start'), { description: error instanceof Error ? error.message : String(error) })
        )
      return
    }
    submitPrompt(session.id, draft.trim(), draftImages)
    patchChatSession(session.id, { draft: '', draftImages: [] })
    setCaret(0)
  }

  // Tabs and explorer files dragged onto the composer become mentions (lib/chat-composer-drop.ts).
  useEffect(() => {
    const box = composerBox.current
    if (!box) return
    const onTabDrop = (event: Event) => {
      if (!(event instanceof CustomEvent) || typeof event.detail?.tabId !== 'string') return
      const { tabId, kind } = event.detail
      const run =
        kind === 'chat'
          ? attachChat(session, tabId)
          : kind === 'terminal'
            ? attachTerminal(session, tabId)
            : Promise.resolve(editorTabPath(tabId, session.workspaceId)).then((path) => path && mentionFile(session, path))
      void run.catch(() => undefined)
    }
    const onFileDrop = (event: Event) => {
      if (!(event instanceof CustomEvent) || typeof event.detail?.path !== 'string') return
      if (event.detail.workspaceId === session.workspaceId) mentionFile(session, event.detail.path)
    }
    box.addEventListener('harness:tab-drop', onTabDrop)
    box.addEventListener('harness:file-drop', onFileDrop)
    return () => {
      box.removeEventListener('harness:tab-drop', onTabDrop)
      box.removeEventListener('harness:file-drop', onFileDrop)
    }
  }, [session])

  /** Opens the @ file menu at the caret, as typing @ would. */
  function startFileMention() {
    const before = draft.slice(0, caret)
    editorRef.current?.replaceRange(caret, caret, before === '' || /\s$/.test(before) ? '@' : ' @')
  }

  async function addImages(list: Iterable<File>) {
    const images = (await Promise.all([...list].map(readImage))).filter((i): i is ChatImage => i !== null)
    if (images.length > 0) patchChatSession(session.id, (c) => ({ draftImages: [...c.draftImages, ...images] }))
  }

  const options = session.options
  const models = catalog?.value?.models?.length ? catalog.value.models : (fallbackModels ?? [])
  const currentModel = models.find((m) => m.value === (options?.model ?? 'default'))
  const canSend = draft.trim().length > 0 || draftImages.length > 0
  const slots = agentOptionSlots(agentState?.options ?? [])
  const changeAgentOption = (optionId: string, value: string) => void setAgentOption(session.id, optionId, value)

  return (
    <div className="shrink-0 bg-chat-canvas select-none">
      <div className="px-3 pt-2 pb-4 sm:px-4">
        {memos && memoOpen ? (
          <div className="mx-auto w-full max-w-(--chat-content-max-width)">
            <NativeChatMemoPanel
              sessionId={session.id}
              onClose={() => {
                setChatMemoOpen(session.id, false)
                editorRef.current?.focus()
              }}
            />
          </div>
        ) : null}
        <div className="relative mx-auto w-full max-w-(--chat-content-max-width)">
          {autocomplete ? (
            <NativeChatAutocompleteMenu autocomplete={autocomplete} activeIndex={selected} listboxId={listboxId} onChoose={choose} />
          ) : null}
          {offline ? (
            <p className="mb-1.5 px-1 text-xs text-muted-foreground" data-composer-offline>
              {t('Reconnecting to {host}… You can keep writing; sending waits until it is back.', { host: hostLabel(session.hostId) })}
            </p>
          ) : null}
          <div
            ref={composerBox}
            data-native-chat-composer
            data-chat-composer-drop
            className={cn(
              'rounded-xl border border-chat-composer-border bg-chat-composer-surface p-1.5 shadow-xs [contain:paint] data-[tab-drop-hover]:border-ring data-[tab-drop-hover]:ring-2 data-[tab-drop-hover]:ring-ring/30',
              dragging && 'border-ring'
            )}
            onDragOver={(event) => {
              if ([...event.dataTransfer.items].some((i) => i.kind === 'file')) {
                event.preventDefault()
                setDragging(true)
              }
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              setDragging(false)
              if (event.dataTransfer.files.length === 0) return
              event.preventDefault()
              void addImages(event.dataTransfer.files)
            }}
          >
            {draftImages.length > 0 ? (
              <div className="flex flex-wrap gap-2 px-1 pt-1.5 pb-1" aria-label={t('Attachments')}>
                {draftImages.map((image, index) => (
                  <div key={index} className="relative size-14 shrink-0" data-native-chat-attachment>
                    <img
                      src={`data:${image.mimeType};base64,${image.data}`}
                      alt={t('Image {n}', { n: index + 1 })}
                      className="size-full rounded-md border border-border bg-chat-canvas object-cover"
                    />
                    <button
                      type="button"
                      aria-label={t('Remove image')}
                      onClick={() =>
                        patchChatSession(session.id, (c) => ({ draftImages: c.draftImages.filter((_, i) => i !== index) }))
                      }
                      className="absolute -top-1.5 -right-1.5 flex size-4 items-center justify-center rounded-full border border-border bg-chat-canvas text-muted-foreground shadow-xs transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                    >
                      <X className="size-3" />
                    </button>
                  </div>
                ))}
              </div>
            ) : null}
            <MarkdownEditor
              ref={editorRef}
              value={draft}
              placeholder={
                offline
                  ? t('Reconnecting to {host}… sending waits until it is back', { host: hostLabel(session.hostId) })
                  : workflow
                    ? t('The task for "{name}"', { name: workflow.name })
                    : working
                      ? t('Queue a follow-up')
                      : (suggestion ?? t('Message the agent'))
              }
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
                setDraft(value)
                setActiveIndex(0)
              }}
              onCaretChange={setCaret}
              onKeyDown={handleKeyDown}
              onPasteFiles={(files) => {
                const images = files.filter((f) => IMAGE_TYPES.has(f.type))
                if (images.length === 0) return false
                void addImages(images)
                return true
              }}
              minHeight="3rem"
              maxHeight="calc(12lh + 0.5rem)"
              className="px-2 py-1 text-sm text-chat-foreground-strong"
            />
            <div className="flex flex-wrap items-center gap-2 pt-0.5">
              {/* One line at any width: the mode and model names shorten instead of wrapping. */}
              <div className="flex w-full min-w-0 items-center justify-between gap-x-2 text-chat-foreground-faint">
                <div className="flex min-w-0 shrink items-center gap-0.5">
                  <NativeChatAttachMenu
                    session={session}
                    onPickImages={() => fileInput.current?.click()}
                    onMentionFile={startFileMention}
                  />
                  <input
                    ref={fileInput}
                    type="file"
                    accept="image/png,image/jpeg,image/gif,image/webp"
                    multiple
                    hidden
                    onChange={(e) => {
                      if (e.target.files) void addImages(e.target.files)
                      e.target.value = ''
                    }}
                  />
                  {external ? (
                    <>
                      {slots.mode ? <NativeChatAgentModePicker option={slots.mode} onChange={changeAgentOption} /> : null}
                      {slots.others.map((option) => (
                        <NativeChatAgentModePicker key={option.id} option={option} onChange={changeAgentOption} />
                      ))}
                    </>
                  ) : options ? (
                    <NativeChatPermissionModePicker
                      current={options.permissionMode}
                      // With no model list at all (its probe failed), Auto stays offered; Claude refuses it if the model cannot.
                      autoAvailable={currentModel ? currentModel.supportsAutoMode === true : models.length === 0}
                      onSelect={(permissionMode) => void setSessionOptions(session.id, { permissionMode })}
                    />
                  ) : null}
                  <NativeChatWorkflowPicker home={workflowHome} picked={workflow} onPick={setWorkflow} />
                </div>
                <div className="ml-auto flex min-w-0 shrink items-center gap-1.5">
                  {external ? (
                    slots.model ? (
                      <NativeChatAgentModelPicker model={slots.model} effort={slots.effort} onChange={changeAgentOption} />
                    ) : agentState?.phase === 'starting' ? (
                      <span className="px-1 text-xs" data-agent-phase="starting">
                        {t('Starting…')}
                      </span>
                    ) : null
                  ) : options ? (
                    <NativeChatSessionOptionPicker
                      options={options}
                      models={models}
                      loading={catalog?.status === 'loading'}
                      onChange={(patch) => void setSessionOptions(session.id, patch)}
                    />
                  ) : null}
                  {usage ? <NativeChatContextUsageRing usage={usage} /> : null}
                  {memos ? <NativeChatMemoButton sessionId={session.id} /> : null}
                  <NativeChatDictationButton
                    onTranscript={(text) => {
                      // Appends to the draft as it is when the transcript lands, not when recording began.
                      const current = editorRef.current?.getValue() ?? draft
                      setDraft(current && !/\s$/.test(current) ? `${current} ${text}` : `${current}${text}`)
                    }}
                  />
                  {/* A disabled button gets no pointer events, so the hint hangs on a wrapper. */}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="inline-flex">
                        <Button
                          type="button"
                          data-native-chat-critical-action={working ? 'stop' : undefined}
                          aria-label={working ? t('Stop the agent') : t('Send')}
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={(event) => {
                            // A double-click lands after the first send started; it must not stop the new turn.
                            if (event.detail > 1) return
                            if (working) stopTurn(session.id)
                            else submit()
                          }}
                          disabled={offline || (!working && !canSend)}
                          variant={working ? 'secondary' : 'default'}
                          size="icon"
                          className="size-8 rounded-full"
                        >
                          {working ? <Square className="size-3.5 fill-current" /> : <ArrowUp className="size-4" />}
                        </Button>
                      </span>
                    </TooltipTrigger>
                    <TooltipContent side="top" sideOffset={4} data-native-chat-send-hint>
                      {offline
                        ? t('Reconnecting to {host}…', { host: hostLabel(session.hostId) })
                        : working
                          ? t('Stop the agent')
                          : t('Send ({key})', { key: SEND_LABEL[sendKey] })}
                    </TooltipContent>
                  </Tooltip>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

/** The workspace file an editor tab shows, when it belongs to `workspaceId`. */
function editorTabPath(tabId: string, workspaceId: string): string | null {
  const tab = getState().editorTabs.find((t) => t.id === tabId)
  return tab && tab.workspaceId === workspaceId ? tab.path : null
}
