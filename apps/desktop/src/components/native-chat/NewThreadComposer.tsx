import { useEffect, useRef } from 'react'
import { chatAgentLabel } from '@zomfy/protocol'
import { toast } from 'sonner'
import { appendToDraft, loadCatalog } from '@/chat-actions'
import { useChatAgents } from '@/lib/chat-agents'
import type { MarkdownEditorHandle } from '@/components/markdown-editor/MarkdownEditor'
import { allWorkspaces, useStore, type ChatImage, type HostId } from '@/session-store'
import { useChatStore } from '@/stores/chat-store'
import { NEW_THREAD_DRAFT, setNewThreadAgent, setNewThreadOptions, useNewThreadStart, type NewThreadStart } from '@/stores/new-thread-store'
import { NativeChatAgentPicker } from './NativeChatAgentPicker'
import { NativeChatAttachMenu } from './NativeChatAttachMenu'
import { NativeChatComposerAction, NativeChatComposerBox, SEND_LABEL } from './NativeChatComposerBox'
import { NativeChatDictationButton } from './NativeChatDictationButton'
import { NativeChatPermissionModePicker } from './NativeChatPermissionModePicker'
import { NativeChatSessionOptionChoices, sessionOptionLabels } from './NativeChatSessionOptionPicker'
import { useNativeChatComposer } from './use-native-chat-composer'
import { getBots, startBotChat } from '@/stores/bots-store'
import { parseBotMention } from '@/lib/bot-mention'
import { t } from '@/i18n/i18n'

// The "New thread" tab's composer: the same box and input as an open chat's (NativeChatComposer),
// before a session exists. It offers what can be known by then: the agent, and for Claude the
// permission mode, model and effort, which the thread's first turn runs with. An ACP agent's own
// modes and models come from its session, so they show once the thread is open. What is picked
// here is remembered for the next new thread (stores/new-thread-store.ts).

const NO_PROMPTS: readonly string[] = []

export function NewThreadComposer({
  hostId,
  workspaceId,
  busy,
  onStart
}: {
  /** The host the thread starts on. */
  hostId: HostId
  /**
   * The folder whose files the `@` menu lists and whose commands the `/` menu lists: the one the
   * thread starts in, or the main checkout of the project it gets a worktree of. Null for a thread
   * that starts in a fresh folder, which has neither yet.
   */
  workspaceId: string | null
  /** The thread is being created. */
  busy: boolean
  onStart: (text: string, images: ChatImage[], start: NewThreadStart) => void
}) {
  const editorRef = useRef<MarkdownEditorHandle>(null)
  const remembered = useNewThreadStart()
  const { agents, kind } = useChatAgents(hostId)
  // An agent picked on another host may not run on this one: Claude does everywhere.
  const agent = remembered.agent !== 'claude' && kind === 'ready' && agents.find((a) => a.id === remembered.agent)?.status !== 'ready' ? 'claude' : remembered.agent
  const claude = agent === 'claude'

  // Models are the account's, not the folder's: any folder on the host can say which there are.
  const catalogWorkspaceId = useStore((s) => workspaceId ?? allWorkspaces(s).find((w) => w.hostId === hostId)?.id ?? null)
  const catalog = useChatStore((s) => (catalogWorkspaceId ? s.catalogs[catalogWorkspaceId] : undefined))
  const fallbackModels = useChatStore(
    (s) =>
      Object.values(s.catalogs)
        .map((c) => c.value?.models)
        .find((m) => m && m.length > 0) ?? null
  )
  useEffect(() => {
    if (claude && catalogWorkspaceId) void loadCatalog(catalogWorkspaceId)
  }, [claude, catalogWorkspaceId])
  const models = catalog?.value?.models?.length ? catalog.value.models : (fallbackModels ?? [])
  const model = models.find((m) => m.value === (remembered.options.model ?? 'default'))
  // An effort the picked model does not have is not sent: the thread starts as the menu reads.
  const effort = remembered.options.effort && (model ? model.efforts.includes(remembered.options.effort) : models.length === 0) ? remembered.options.effort : null
  const options = { ...remembered.options, effort }
  const labels = sessionOptionLabels(options, models)

  const composer = useNativeChatComposer({
    draftId: NEW_THREAD_DRAFT,
    hostId,
    editorRef,
    // Claude's commands are its folder's; another agent's arrive with its session.
    commands: claude && workspaceId ? { items: catalog?.value?.commands ?? [], status: catalog?.status ?? 'loading' } : null,
    filesWorkspaceId: workspaceId,
    suggestion: null,
    history: () => NO_PROMPTS,
    onSubmit: submit
  })
  const { draft, draftImages, sendKey } = composer
  const canSend = draft.trim().length > 0 || draftImages.length > 0

  function submit() {
    if (busy || !canSend) return
    // `@handle …` at the start asks that bot in a new bot chat, as an open chat's composer does.
    const mention = parseBotMention(draft, getBots().bots ?? [])
    if (mention) {
      const asked = draft
      composer.clear()
      void startBotChat(mention.bot.id, mention.text || undefined).catch((error: unknown) => {
        appendToDraft(NEW_THREAD_DRAFT, asked)
        toast.error(t('{name} could not take it', { name: mention.bot.name }), { description: error instanceof Error ? error.message : String(error) })
      })
      return
    }
    onStart(draft.trim(), draftImages, { agent, options })
  }

  // The tab opens ready to type, and is again once a thread has started from it.
  useEffect(() => {
    if (!busy) editorRef.current?.focus()
  }, [busy])

  return (
    <NativeChatComposerBox
      composer={composer}
      editorRef={editorRef}
      placeholder={t('Ask anything, or describe a task')}
      left={
        <NativeChatAttachMenu session={null} onPickImages={composer.pickImages} onMentionFile={workspaceId ? composer.startFileMention : undefined} />
      }
      right={
        <>
          <NativeChatAgentPicker
            hostId={hostId}
            current={agent}
            model={claude ? labels.model : null}
            detail={claude ? labels.effort : null}
            spoken={claude ? labels.spoken : undefined}
            onSelect={setNewThreadAgent}
          >
            {(close) =>
              !claude ? (
                <p className="px-3 py-2.5 text-xs leading-snug text-muted-foreground" data-new-thread-agent-note>
                  {t("{agent}'s own models and modes can be picked once the thread has started.", { agent: chatAgentLabel(agent) })}
                </p>
              ) : models.length === 0 && catalog?.status !== 'loading' ? (
                <p className="px-3 py-2.5 text-xs leading-snug text-muted-foreground" data-new-thread-agent-note>
                  {t("The thread starts with Claude's default model. Its models can be picked once the thread has started.")}
                </p>
              ) : (
                <NativeChatSessionOptionChoices
                  options={options}
                  models={models}
                  loading={catalog?.status === 'loading'}
                  onChange={setNewThreadOptions}
                  onDone={close}
                />
              )
            }
          </NativeChatAgentPicker>
          {claude ? (
            <NativeChatPermissionModePicker
              current={options.permissionMode}
              // With no model list at all, Auto stays offered; Claude refuses it if the model cannot.
              autoAvailable={model ? model.supportsAutoMode === true : models.length === 0}
              onSelect={(permissionMode) => setNewThreadOptions({ permissionMode })}
            />
          ) : null}
          <NativeChatDictationButton
            onTranscript={(text) => {
              // Appends to the draft as it is when the transcript lands, not when recording began.
              const current = editorRef.current?.getValue() ?? draft
              composer.setDraft(current && !/\s$/.test(current) ? `${current} ${text}` : `${current}${text}`)
            }}
          />
        </>
      }
      actions={
        busy ? (
          <NativeChatComposerAction kind="busy" label={t('Starting the thread…')} onClick={() => {}} />
        ) : (
          <NativeChatComposerAction
            kind="send"
            label={t('Start thread ({key})', { key: SEND_LABEL[sendKey] })}
            disabled={!canSend}
            onClick={submit}
          />
        )
      }
    />
  )
}
