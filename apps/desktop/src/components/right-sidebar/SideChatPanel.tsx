import { useEffect, useState } from 'react'
import { CornerDownLeft, MessageSquarePlus, Plus } from 'lucide-react'
import { SIDE_CHAT_DEFAULT_CONTEXT_MESSAGES, isChatAgentId, type ChatAgentId } from '@acp-harness/protocol'
import { ensureSessionLoaded } from '@/daemon-connection'
import { useStore, type Session } from '@/session-store'
import { mainChatOf, sendToMainChat, sideChatOf, startSideChat } from '@/side-chat-actions'
import { useChatAgents } from '@/lib/chat-agents'
import { ThreadView } from '@/components/ThreadView'
import { TuiAgentIcon } from '@/components/terminal/TuiAgentIcon'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
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
  const [setupOpen, setSetupOpen] = useState(false)

  const sideId = side?.id
  useEffect(() => {
    if (sideId) void ensureSessionLoaded(sideId)
  }, [sideId])

  async function start(agent: ChatAgentId, contextMessages: number) {
    if (!main) return
    setStarting(true)
    setError(null)
    try {
      await startSideChat(main, agent, contextMessages)
      setSetupOpen(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setStarting(false)
    }
  }

  const lastAnswer = side?.items.findLast((i) => i.kind === 'agent')
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-side-chat-panel>
      <div className="flex h-8 shrink-0 items-center gap-1 border-b border-border px-2">
        <span className="min-w-0 truncate text-xs text-muted-foreground" title={anchor?.title}>
          {anchor ? t('Beside “{title}”', { title: anchor.title }) : t('No chat in this workspace')}
        </span>
        <div className="ml-auto flex shrink-0 items-center">
          {side && anchor && lastAnswer?.kind === 'agent' ? (
            <IconAction
              label={t('Send last answer to main chat')}
              data="send-last"
              onClick={() => sendToMainChat(anchor, lastAnswer.text)}
            >
              <CornerDownLeft className="size-3.5" />
            </IconAction>
          ) : null}
          {side && main ? (
            <IconAction label={t('New side chat')} data="new" onClick={() => setSetupOpen((open) => !open)}>
              <Plus className="size-3.5" />
            </IconAction>
          ) : null}
        </div>
      </div>
      {error ? <p className="border-b border-border px-3 py-2 text-xs text-destructive">{error}</p> : null}
      {main && (!side || setupOpen) ? (
        <SideChatSetup
          hostId={main.hostId}
          mainTitle={main.title}
          starting={starting}
          onStart={(agent, context) => void start(agent, context)}
          onCancel={side ? () => setSetupOpen(false) : undefined}
        />
      ) : null}
      {side ? (
        <ThreadView
          key={side.id}
          session={side}
          onSendToMain={anchor ? (text) => sendToMainChat(anchor, text) : undefined}
        />
      ) : !main ? (
        <p className="px-3 py-6 text-center text-xs text-muted-foreground">
          {t('Start a chat in this workspace first; a side chat asks about it without interrupting.')}
        </p>
      ) : null}
    </div>
  )
}

function SideChatSetup({
  hostId,
  mainTitle,
  starting,
  onStart,
  onCancel
}: {
  hostId: Session['hostId']
  mainTitle: string
  starting: boolean
  onStart: (agent: ChatAgentId, contextMessages: number) => void
  onCancel?: () => void
}) {
  const { agents } = useChatAgents(hostId)
  const ready = agents.filter((a) => a.id !== 'claude' && a.status === 'ready')
  const [agent, setAgent] = useState<ChatAgentId>('claude')
  const [withContext, setWithContext] = useState(true)
  return (
    <div className="flex shrink-0 flex-col gap-3 border-b border-border px-3 py-3" data-side-chat-setup>
      <p className="text-xs text-muted-foreground">
        {t('Ask a quick question about this workspace. The main chat keeps working and its conversation is not touched.')}
      </p>
      <div className="flex items-center gap-2">
        <Select value={agent} onValueChange={(value) => isChatAgentId(value) && setAgent(value)}>
          <SelectTrigger size="sm" className="min-w-0 flex-1" aria-label={t('Side chat agent')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent position="popper">
            <SelectItem value="claude">
              <TuiAgentIcon agent="claude" size={14} />
              {t('Claude (low effort)')}
            </SelectItem>
            {ready.map((a) => (
              <SelectItem key={a.id} value={a.id}>
                <TuiAgentIcon agent={a.id} size={14} />
                {a.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex items-center gap-2">
        <Checkbox
          id="side-chat-context"
          checked={withContext}
          onCheckedChange={(checked) => setWithContext(checked === true)}
        />
        <Label htmlFor="side-chat-context" className="min-w-0 text-xs font-normal">
          <span className="truncate">{t('Include recent messages from “{title}”', { title: mainTitle })}</span>
        </Label>
      </div>
      <div className="flex justify-end gap-2">
        {onCancel ? (
          <Button size="sm" variant="ghost" onClick={onCancel}>
            {t('Cancel')}
          </Button>
        ) : null}
        <Button
          size="sm"
          disabled={starting}
          data-side-chat-start
          onClick={() => onStart(agent, withContext ? SIDE_CHAT_DEFAULT_CONTEXT_MESSAGES : 0)}
        >
          <MessageSquarePlus />
          {starting ? t('Starting…') : t('Start side chat')}
        </Button>
      </div>
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
