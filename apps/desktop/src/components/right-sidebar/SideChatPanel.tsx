import { useEffect, useState } from 'react'
import { CornerDownLeft, MessagesSquare, Plus, Undo2 } from 'lucide-react'
import { SIDE_CHAT_DEFAULT_CONTEXT_MESSAGES, type ChatAgentId } from '@acp-harness/protocol'
import { ensureSessionLoaded } from '@/daemon-connection'
import { getState, useStore, type ChatImage } from '@/session-store'
import { mainChatOf, sendToMainChat, sideChatOf, startSideChat } from '@/side-chat-actions'
import { submitPrompt } from '@/chat-actions'
import { patchChatSession } from '@/stores/chat-store'
import { ThreadView } from '@/components/ThreadView'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { SideChatComposer, sideChatDraftId } from './SideChatComposer'
import { t } from '@/i18n/i18n'

// Orca has no side chat; this follows Claude Code's /btw: a short-lived chat in the same workspace
// that sees the main chat's latest messages and leaves that conversation alone.

export function SideChatPanel({ workspaceId }: { workspaceId: string }) {
  const sessions = useStore((s) => s.sessions)
  const activeTabs = useStore((s) => s.activeSessionByWorkspace)
  const side = sideChatOf(sessions, workspaceId)
  const main = mainChatOf(sessions, activeTabs, workspaceId)
  // The chat this side chat was opened beside, while it is still open.
  const anchor = (side?.sideOf && sessions.find((s) => s.id === side.sideOf)) || main
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // "New side chat" shows an empty box; the old side chat closes once the new one starts.
  const [fresh, setFresh] = useState(false)

  const sideId = side?.id
  useEffect(() => {
    if (sideId) void ensureSessionLoaded(sideId)
  }, [sideId])

  async function start(text: string, images: ChatImage[], agent: ChatAgentId) {
    if (!main) return
    setStarting(true)
    setError(null)
    try {
      await startSideChat(main, agent, SIDE_CHAT_DEFAULT_CONTEXT_MESSAGES)
      const started = sideChatOf(getState().sessions, workspaceId)
      if (!started) throw new Error(t('The side chat did not start.'))
      patchChatSession(sideChatDraftId(workspaceId), { draft: '', draftImages: [] })
      submitPrompt(started.id, text, images)
      setFresh(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setStarting(false)
    }
  }

  const composing = Boolean(main) && (!side || fresh)
  const lastAnswer = side?.items.findLast((i) => i.kind === 'agent')
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-side-chat-panel>
      <div className="flex h-8 shrink-0 items-center gap-1 border-b border-border px-2">
        <span className="min-w-0 truncate text-xs text-muted-foreground" title={anchor?.title}>
          {anchor ? t('Beside “{title}”', { title: anchor.title }) : t('No thread in this workspace')}
        </span>
        <div className="ml-auto flex shrink-0 items-center">
          {side && !composing && anchor && lastAnswer?.kind === 'agent' ? (
            <IconAction
              label={t('Send last answer to main thread')}
              data="send-last"
              onClick={() => sendToMainChat(anchor, lastAnswer.text)}
            >
              <CornerDownLeft className="size-3.5" />
            </IconAction>
          ) : null}
          {side && main && !composing ? (
            <IconAction label={t('New side chat')} data="new" onClick={() => setFresh(true)}>
              <Plus className="size-3.5" />
            </IconAction>
          ) : null}
          {side && fresh ? (
            <IconAction label={t('Back to the side chat')} data="back" onClick={() => setFresh(false)}>
              <Undo2 className="size-3.5" />
            </IconAction>
          ) : null}
        </div>
      </div>
      {error ? <p className="border-b border-border px-3 py-2 text-xs text-destructive">{error}</p> : null}
      {composing && main ? (
        <>
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-6 text-center" data-side-chat-empty>
            <MessagesSquare className="size-5 text-muted-foreground/70" />
            <p className="text-xs leading-relaxed text-muted-foreground">
              {t('Ask a quick question about this workspace. The main thread keeps working and its conversation is not touched.')}
            </p>
          </div>
          <SideChatComposer
            hostId={main.hostId}
            workspaceId={workspaceId}
            busy={starting}
            onStart={(text, images, agent) => void start(text, images, agent)}
          />
        </>
      ) : side ? (
        <ThreadView
          key={side.id}
          session={side}
          onSendToMain={anchor ? (text) => sendToMainChat(anchor, text) : undefined}
        />
      ) : (
        <p className="px-3 py-6 text-center text-xs text-muted-foreground">
          {t('Start a thread in this workspace first; a side chat asks about it without interrupting.')}
        </p>
      )}
    </div>
  )
}

function IconAction({
  label,
  data,
  onClick,
  children
}: {
  label: string
  data: string
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button size="icon-xs" variant="ghost" aria-label={label} data-side-chat-action={data} onClick={onClick}>
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  )
}
