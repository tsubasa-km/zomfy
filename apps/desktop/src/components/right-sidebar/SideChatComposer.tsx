import { useEffect, useRef, useState } from 'react'
import { chatAgentLabel, isGuardedChatAgent, type ChatAgentId } from '@zomfy/protocol'
import type { MarkdownEditorHandle } from '@/components/markdown-editor/MarkdownEditor'
import type { ChatImage, HostId } from '@/session-store'
import { NativeChatAgentPicker } from '@/components/native-chat/NativeChatAgentPicker'
import { NativeChatAttachMenu } from '@/components/native-chat/NativeChatAttachMenu'
import { NativeChatComposerAction, NativeChatComposerBox, SEND_LABEL } from '@/components/native-chat/NativeChatComposerBox'
import { useNativeChatComposer } from '@/components/native-chat/use-native-chat-composer'
import { t } from '@/i18n/i18n'

// A side chat before it exists: the same box as an open chat's, so asking aside feels like asking
// in the main thread. The first message starts the side chat, handed the main thread's recent
// messages, and is sent in it; there is no setup step.

const NO_PROMPTS: readonly string[] = []

/** The draft's entry in the chat store, one per workspace's side chat. */
export const sideChatDraftId = (workspaceId: string) => `draft:side-chat:${workspaceId}`

export function SideChatComposer({
  hostId,
  workspaceId,
  busy,
  onStart
}: {
  hostId: HostId
  workspaceId: string
  busy: boolean
  onStart: (text: string, images: ChatImage[], agent: ChatAgentId) => void
}) {
  const editorRef = useRef<MarkdownEditorHandle>(null)
  const [agent, setAgent] = useState<ChatAgentId>('claude')
  const composer = useNativeChatComposer({
    draftId: sideChatDraftId(workspaceId),
    hostId,
    editorRef,
    commands: null,
    filesWorkspaceId: workspaceId,
    suggestion: null,
    history: () => NO_PROMPTS,
    onSubmit: submit
  })
  const { draft, draftImages, sendKey } = composer
  const canSend = draft.trim().length > 0 || draftImages.length > 0

  function submit() {
    if (busy || !canSend) return
    onStart(draft.trim(), draftImages, agent)
  }

  useEffect(() => {
    if (!busy) editorRef.current?.focus()
  }, [busy])

  return (
    <div className="flex shrink-0 flex-col gap-1 px-2 pb-1.5" data-side-chat-composer>
      <NativeChatComposerBox
        composer={composer}
        editorRef={editorRef}
        placeholder={t('Ask about this workspace without interrupting')}
        left={<NativeChatAttachMenu session={null} onPickImages={composer.pickImages} onMentionFile={composer.startFileMention} />}
        right={
          <NativeChatAgentPicker
            hostId={hostId}
            current={agent}
            model={null}
            // A side chat is handed the main conversation, which a guarded agent never takes.
            onSelect={(next) => !isGuardedChatAgent(next) && setAgent(next)}
            closeOnSelect
          >
            {() => (
              <p className="px-3 py-2.5 text-xs leading-snug text-muted-foreground" data-side-chat-agent-note>
                {agent === 'claude'
                  ? t('Claude answers a side chat on low effort; its model and effort can be changed once it has started.')
                  : t("{agent}'s own models and modes can be picked once the thread has started.", { agent: chatAgentLabel(agent) })}
              </p>
            )}
          </NativeChatAgentPicker>
        }
        actions={
          busy ? (
            <NativeChatComposerAction kind="busy" label={t('Starting the side chat…')} onClick={() => {}} />
          ) : (
            <NativeChatComposerAction kind="send" label={t('Send ({key})', { key: SEND_LABEL[sendKey] })} disabled={!canSend} onClick={submit} />
          )
        }
      />
    </div>
  )
}
