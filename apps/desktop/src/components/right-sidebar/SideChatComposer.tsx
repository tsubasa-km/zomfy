import { useEffect, useRef, useState } from 'react'
import { History } from 'lucide-react'
import { chatAgentLabel, isGuardedChatAgent, type ChatAgentId } from '@acp-harness/protocol'
import type { MarkdownEditorHandle } from '@/components/markdown-editor/MarkdownEditor'
import type { ChatImage, HostId } from '@/session-store'
import { NativeChatAgentPicker } from '@/components/native-chat/NativeChatAgentPicker'
import { NativeChatAttachMenu } from '@/components/native-chat/NativeChatAttachMenu'
import { NativeChatComposerAction, NativeChatComposerBox, SEND_LABEL } from '@/components/native-chat/NativeChatComposerBox'
import { useNativeChatComposer } from '@/components/native-chat/use-native-chat-composer'
import { cn } from '@/lib/utils'
import { t } from '@/i18n/i18n'

// A side chat before it exists: the same box as an open chat's, so asking aside feels like asking
// in the main thread. The first message starts the side chat and is sent in it; there is no setup
// step. Whether it is handed the main thread's recent messages is a toggle under the box.

const NO_PROMPTS: readonly string[] = []

/** The draft's entry in the chat store, one per workspace's side chat. */
export const sideChatDraftId = (workspaceId: string) => `draft:side-chat:${workspaceId}`

export function SideChatComposer({
  hostId,
  workspaceId,
  mainTitle,
  busy,
  onStart
}: {
  hostId: HostId
  workspaceId: string
  mainTitle: string
  busy: boolean
  onStart: (text: string, images: ChatImage[], agent: ChatAgentId, withContext: boolean) => void
}) {
  const editorRef = useRef<MarkdownEditorHandle>(null)
  const [agent, setAgent] = useState<ChatAgentId>('claude')
  const [withContext, setWithContext] = useState(true)
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
    onStart(draft.trim(), draftImages, agent, withContext)
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
      <div className="px-2">
        <button
          type="button"
          aria-pressed={withContext}
          data-side-chat-context
          onClick={() => setWithContext(!withContext)}
          title={t('Include recent messages from “{title}”', { title: mainTitle })}
          className={cn(
            'inline-flex max-w-full items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] transition-colors',
            withContext ? 'text-foreground/80 hover:bg-accent' : 'text-muted-foreground line-through hover:bg-accent'
          )}
        >
          <History className="size-3 shrink-0" />
          <span className="truncate">{t('Sees recent messages from “{title}”', { title: mainTitle })}</span>
        </button>
      </div>
    </div>
  )
}
