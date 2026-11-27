import { memo, useEffect, useRef, useState } from 'react'
import { leaveChatForNewChat, returnsToNewChat } from '@/lib/chat-after-send'
import type { Session } from '@/session-store'
import { useChatSession, useChatStore } from '@/stores/chat-store'
import {
  appendToDraft,
  isWorking,
  loadCatalog,
  setAgentOption,
  setSessionAgent,
  setSessionOptions,
  resumeQueue,
  steerQueued,
  stopTurn,
  useStopping,
  submitPrompt
} from '@/chat-actions'
import { NativeChatPermissionModePicker } from './NativeChatPermissionModePicker'
import { NativeChatSessionOptionChoices, sessionOptionLabels } from './NativeChatSessionOptionPicker'
import { NativeChatContextUsageRing } from './NativeChatContextUsageRing'
import { NativeChatDictationButton } from './NativeChatDictationButton'
import { NativeChatAgentModePicker, NativeChatAgentModelChoices, agentOptionSlots, choiceName } from './NativeChatAgentOptionPickers'
import { NativeChatAgentPicker } from './NativeChatAgentPicker'
import { NativeChatComposerAction, NativeChatComposerBox, SEND_LABEL } from './NativeChatComposerBox'
import { useNativeChatComposer } from './use-native-chat-composer'
import { sentPrompts } from './native-chat-prompt-recall'
import { isExternalAgentSession, sessionAgent } from '@/lib/chat-agents'
import { useSetting } from '@/stores/settings-store'
import type { MarkdownEditorHandle } from '@/components/markdown-editor/MarkdownEditor'
import { loadChatMemo, setChatMemoOpen, useChatMemo } from '@/stores/chat-memo-store'
import { NativeChatMemoButton, NativeChatMemoPanel } from './NativeChatMemoPanel'
import { NativeChatAttachMenu } from './NativeChatAttachMenu'
import { attachChat, attachTerminal, mentionFile } from '@/lib/chat-attachments'
import { NativeChatWorkflowPicker, type WorkflowHome } from './NativeChatWorkflowPicker'
import { toast } from 'sonner'
import { HARNESS_METHODS } from '@zomfy/protocol'
import { harnessRequest } from '@/daemon-connection'
import { projectOfSession } from '@/lib/session-project'
import { mainLocationOf } from '@/stores/project-catalog-store'
import { upsertWorkflowRun } from '@/stores/workflow-runs-store'
import { confirmWorkflowStart } from '@/components/workflows/WorkflowStartConfirm'
import { allWorkspaces, getState, hostLabel, LOCAL_HOST, useStore } from '@/session-store'
import { useLasting } from '@/hooks/use-lasting'
import { getBots, startBotChat } from '@/stores/bots-store'
import { parseBotMention } from '@/lib/bot-mention'
import { t } from '@/i18n/i18n'
import { projectLabel } from '@/components/sidebar/workspace-visibility'

// An open chat's composer: what the chat adds to the shared input (use-native-chat-composer) and
// box (NativeChatComposerBox). The "New thread" tab's is NewThreadComposer.

type ComposerProps = {
  session: Session
  editorRef: React.RefObject<MarkdownEditorHandle | null>
  /** It is simply the person's turn: the box glows until they start typing (composer-waiting-glow.md). */
  glow?: boolean
}

/**
 * The session fields the composer (and the menus it hands the session to) reads. Its session
 * changes with every streamed chunk; without this, the whole composer would render with each one.
 */
/** How long a host may take to (re)connect before the composer says it is waiting for it. */
const OFFLINE_NOTICE_DELAY_MS = 1500

const COMPOSER_SESSION_FIELDS = ['id', 'workspaceId', 'hostId', 'status', 'agent', 'agentState', 'options', 'promptSuggestion', 'sideOf', 'role', 'localOnly'] as const

export const NativeChatComposer = memo(
  Composer,
  (prev: ComposerProps, next: ComposerProps) =>
    prev.editorRef === next.editorRef && prev.glow === next.glow && COMPOSER_SESSION_FIELDS.every((key) => prev.session[key] === next.session[key])
)

function Composer({ session, editorRef, glow = false }: ComposerProps) {
  const { usage, queue } = useChatSession(session.id)
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
  const working = isWorking(session)
  // Stop was pressed and the agent is still winding down: the button says so instead of seeming dead.
  const stopping = useStopping(session.id)
  // Sending or stopping needs the host; while it reconnects the person can still write.
  const offline = useStore((s) => s.hosts[session.hostId]?.connection.kind !== 'connected')
  // Connecting at startup takes a moment; saying so only when it lasts keeps the composer from
  // growing a line and shrinking again as the window opens.
  const offlineNotice = useLasting(offline, OFFLINE_NOTICE_DELAY_MS)
  // Other agents bring their own commands and options over ACP; the workspace catalog is Claude's.
  const external = isExternalAgentSession(session)
  const agentState = session.agentState
  const composerBox = useRef<HTMLDivElement>(null)
  const [workflow, setWorkflow] = useState<{ id: string; name: string } | null>(null)
  // Workflows are saved with the project's main member, which may be on another host.
  const chatProject = projectOfSession(session)
  const mainMember = chatProject ? mainLocationOf({ hostId: chatProject.hostId, projectId: chatProject.id }) : null
  const workflowHome: WorkflowHome = {
    hostId: mainMember?.hostId ?? session.hostId,
    projectId: mainMember?.projectId ?? chatProject?.id ?? null,
    projectName: chatProject ? projectLabel(chatProject) : ''
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

  const composer = useNativeChatComposer({
    draftId: session.id,
    hostId: session.hostId,
    editorRef,
    commands: external
      ? { items: agentState?.commands ?? [], status: agentState?.phase === 'starting' ? 'loading' : 'ready' }
      : { items: catalog?.value?.commands ?? [], status: catalog?.status ?? 'loading' },
    filesWorkspaceId: session.workspaceId,
    // The daemon lists a chat's MCP servers for Claude chats; other agents' get none.
    connectorsSessionId: external ? null : session.id,
    // Claude's guess at the next prompt shows in the empty composer.
    suggestion: working ? null : (session.promptSuggestion ?? null),
    // Read when asked: the composer does not render with each streamed chunk of the transcript.
    history: () => sentPrompts(getState().sessions.find((s) => s.id === session.id)?.items ?? []),
    onSubmit: submit
  })
  const { draft, draftImages, sendKey, suggestion } = composer

  function submit() {
    if (!offline && !workflow && !draft.trim() && draftImages.length === 0 && queue[0]) {
      // The send key again on an empty composer sends the queued message now (the queue's ▶):
      // pressed twice, a follow-up typed while a turn runs goes at once instead of waiting.
      if (working) steerQueued(session.id, queue[0].id)
      else resumeQueue(session.id)
      return
    }
    if (offline || (!draft.trim() && draftImages.length === 0)) return
    // `@handle …` at the start asks that bot in a new bot chat, linked back to this one.
    const mention = workflow ? null : parseBotMention(draft, getBots().bots ?? [])
    if (mention) {
      const asked = draft
      composer.clear()
      void startBotChat(mention.bot.id, mention.text || undefined, session.hostId === LOCAL_HOST ? session.id : undefined).catch((error: unknown) => {
        appendToDraft(session.id, asked)
        toast.error(t('{name} could not take it', { name: mention.bot.name }), { description: error instanceof Error ? error.message : String(error) })
      })
      return
    }
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
          composer.clear()
        })
        .catch((error: unknown) =>
          toast.error(t('The workflow did not start'), { description: error instanceof Error ? error.message : String(error) })
        )
      return
    }
    submitPrompt(session.id, draft.trim(), draftImages)
    composer.clear()
    if (returnsToNewChat(session.workspaceId, Boolean(session.sideOf))) leaveChatForNewChat(session.id)
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

  const options = session.options
  const models = catalog?.value?.models?.length ? catalog.value.models : (fallbackModels ?? [])
  const currentModel = models.find((m) => m.value === (options?.model ?? 'default'))
  const canSend = draft.trim().length > 0 || draftImages.length > 0
  const slots = agentOptionSlots(agentState?.options ?? [])
  const changeAgentOption = (optionId: string, value: string) => void setAgentOption(session.id, optionId, value)
  // The Manager and Lead chats are Claude with the harness's own instructions, and a workflow step's
  // local-only data stays with the agent it was given to: their agent does not change.
  const agentChangeable = !session.role && !session.localOnly
  const agentLocked = working
    ? t('Stop the agent to change it')
    : offline
      ? t('Reconnecting to {host}…', { host: hostLabel(session.hostId) })
      : null
  const claudeLabels = !external && options ? sessionOptionLabels(options, models, session.defaultEffort) : null
  const reconnecting = t('Reconnecting to {host}…', { host: hostLabel(session.hostId) })
  const key = SEND_LABEL[sendKey]

  return (
    <div className="shrink-0 bg-chat-canvas select-none">
      {/* Its bottom padding also keeps the box clear of a drawer handle docked below (--tab-bottom-inset). */}
      <div className="px-3 pt-2 pb-[max(--spacing(4),var(--tab-bottom-inset,0px))] sm:px-4">
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
        <div className="mx-auto w-full max-w-(--chat-content-max-width)">
          <NativeChatComposerBox
            composer={composer}
            editorRef={editorRef}
            boxRef={composerBox}
            takesTabDrops
            waiting={glow && !draft.trim() && draftImages.length === 0}
            placeholder={
              offlineNotice
                ? t('Reconnecting to {host}… sending waits until it is back', { host: hostLabel(session.hostId) })
                : workflow
                  ? t('The task for "{name}"', { name: workflow.name })
                  : working
                    ? queue.length > 0
                      ? t('Queue a follow-up, or {key} to send the queued one now', { key })
                      : t('Queue a follow-up')
                    : (suggestion ?? t('Message the agent'))
            }
            notice={
              offlineNotice ? (
                <p className="mb-1.5 px-1 text-xs text-muted-foreground" data-composer-offline>
                  {t('Reconnecting to {host}… You can keep writing; sending waits until it is back.', { host: hostLabel(session.hostId) })}
                </p>
              ) : null
            }
            left={
              <>
                <NativeChatAttachMenu
                  session={session}
                  onPickImages={composer.pickImages}
                  onMentionFile={composer.startFileMention}
                  skills={composer.skills}
                  onPickSkill={composer.insertSkill}
                  connectors={external ? null : { sessionId: session.id, hostId: session.hostId }}
                  onPickConnector={composer.insertConnector}
                />
                <NativeChatWorkflowPicker home={workflowHome} picked={workflow} onPick={setWorkflow} />
                {memos ? <NativeChatMemoButton sessionId={session.id} /> : null}
              </>
            }
            right={
              <>
                {external ? (
                  <NativeChatAgentPicker
                    hostId={session.hostId}
                    current={sessionAgent(session)}
                    model={slots.model ? choiceName(slots.model) : null}
                    detail={slots.model ? (slots.effort ? choiceName(slots.effort) : null) : agentState?.phase === 'starting' ? t('Starting…') : null}
                    spoken={
                      slots.model
                        ? `${slots.model.name} ${choiceName(slots.model)}${slots.effort ? `, ${slots.effort.name} ${choiceName(slots.effort)}` : ''}`
                        : undefined
                    }
                    disabledReason={agentLocked}
                    note={AGENT_SWITCH_NOTE}
                    closeOnSelect
                    switching
                    onSelect={agentChangeable ? (agent) => void setSessionAgent(session.id, agent) : undefined}
                  >
                    {(close) =>
                      slots.model ? (
                        <NativeChatAgentModelChoices model={slots.model} effort={slots.effort} onChange={changeAgentOption} onDone={close} />
                      ) : (
                        <p className="px-3 py-2.5 text-xs text-muted-foreground" data-agent-phase={agentState?.phase}>
                          {agentState?.phase === 'starting'
                            ? t('Starting…')
                            : ((agentState?.phase === 'failed' ? agentState.error : null) ?? t('This agent offers no model to pick here.'))}
                        </p>
                      )
                    }
                  </NativeChatAgentPicker>
                ) : options || agentChangeable ? (
                  <NativeChatAgentPicker
                    hostId={session.hostId}
                    current="claude"
                    model={claudeLabels?.model ?? null}
                    detail={claudeLabels?.effort}
                    spoken={claudeLabels?.spoken}
                    disabledReason={agentLocked}
                    note={AGENT_SWITCH_NOTE}
                    closeOnSelect
                    switching
                    onSelect={agentChangeable ? (agent) => void setSessionAgent(session.id, agent) : undefined}
                  >
                    {(close) =>
                      options ? (
                        <NativeChatSessionOptionChoices
                          options={options}
                          models={models}
                          loading={catalog?.status === 'loading'}
                          defaultEffort={session.defaultEffort}
                          onChange={(patch) => void setSessionOptions(session.id, patch)}
                          onDone={close}
                        />
                      ) : (
                        // A daemon that predates composer options: the agent can change, its model cannot.
                        <p className="px-3 py-2.5 text-xs text-muted-foreground">{t('This agent offers no model to pick here.')}</p>
                      )
                    }
                  </NativeChatAgentPicker>
                ) : null}
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
                {usage ? <NativeChatContextUsageRing usage={usage} chat={{ hostId: session.hostId, sessionId: session.id, workspaceId: session.workspaceId }} /> : null}
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
              working ? (
                <>
                  {stopping ? (
                    <NativeChatComposerAction kind="busy" label={t('Stopping…')} onClick={() => undefined} />
                  ) : (
                    <NativeChatComposerAction kind="stop" label={t('Stop the agent')} hint={offline ? reconnecting : undefined} disabled={offline} onClick={() => stopTurn(session.id)} />
                  )}
                  {/* With something written the round button is the follow-up's: it queues behind the running turn. */}
                  {canSend && !offline ? (
                    workflow ? (
                      <NativeChatComposerAction kind="send" label={t('Send')} hint={t('Send ({key})', { key })} onClick={submit} />
                    ) : (
                      <NativeChatComposerAction kind="queue" label={t('Queue message')} hint={t('Queue message ({key})', { key })} onClick={submit} />
                    )
                  ) : null}
                </>
              ) : !canSend && queue[0] && !workflow ? (
                <NativeChatComposerAction
                  kind="resume"
                  label={t('Send the queued message now')}
                  hint={offline ? reconnecting : t('Send the queued message now ({key})', { key })}
                  disabled={offline}
                  onClick={submit}
                />
              ) : (
                <NativeChatComposerAction
                  kind="send"
                  label={t('Send')}
                  hint={offline ? reconnecting : t('Send ({key})', { key })}
                  disabled={offline || !canSend}
                  onClick={submit}
                />
              )
            }
          />
        </div>
      </div>
    </div>
  )
}

const AGENT_SWITCH_NOTE = t("The thread stays. The new agent gets a selection of this conversation as text, not the previous agent's context.")

/** The workspace file an editor tab shows, when it belongs to `workspaceId`. */
function editorTabPath(tabId: string, workspaceId: string): string | null {
  const tab = getState().editorTabs.find((t) => t.id === tabId)
  return tab && tab.workspaceId === workspaceId ? tab.path : null
}
