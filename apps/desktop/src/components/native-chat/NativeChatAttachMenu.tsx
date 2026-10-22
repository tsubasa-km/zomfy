import { useMemo } from 'react'
import { AtSign, ImagePlus, MessageSquare, Plus, SquareTerminal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { attachChat, attachTerminal } from '@/lib/chat-attachments'
import { allWorkspaces, useStore, type Session } from '@/session-store'

/** Chats and terminals offered, newest first; the rest stay reachable by dragging their tabs in. */
const MENU_LIMIT = 30

/**
 * The composer's +: an image, a workspace file (the @ menu), or a snapshot of another chat or a
 * terminal from any workspace or host, inserted as a mention.
 */
export function NativeChatAttachMenu({
  session,
  onPickImages,
  onMentionFile
}: {
  session: Session
  onPickImages: () => void
  onMentionFile: () => void
}) {
  const sessions = useStore((s) => s.sessions)
  const terminals = useStore((s) => s.terminals)
  const hosts = useStore((s) => s.hosts)
  const workspaceName = useMemo(() => {
    const names = new Map(allWorkspaces({ hosts }).map((w) => [w.id, w.displayName || w.name]))
    return (id: string) => names.get(id) ?? ''
  }, [hosts])
  // This workspace's first, then the newest.
  const order = <T extends { workspaceId: string; createdAt: number }>(list: T[]) =>
    list
      .toSorted((a, b) => Number(b.workspaceId === session.workspaceId) - Number(a.workspaceId === session.workspaceId) || b.createdAt - a.createdAt)
      .slice(0, MENU_LIMIT)
  const chats = order(sessions.filter((s) => s.id !== session.id && !s.sideOf))
  // Run terminals under code blocks count too; often they are the only ones open.
  const shells = order(terminals)
  const attach = (run: () => Promise<void>) => void run().catch(() => undefined)

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="ghost" size="icon-sm" aria-label="Attach" data-native-chat-attach>
              <Plus className="size-4" />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="top" sideOffset={4}>
          Attach
        </TooltipContent>
      </Tooltip>
      <DropdownMenuContent
        side="top"
        align="start"
        className="w-56"
        // The picked item puts the caret in the composer; returning focus to + would take it back.
        onCloseAutoFocus={(event) => event.preventDefault()}
      >
        <DropdownMenuItem onSelect={onPickImages}>
          <ImagePlus />
          Image…
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onMentionFile}>
          <AtSign />
          File in this workspace…
        </DropdownMenuItem>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <MessageSquare />
            Chat
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="max-h-80 w-72 overflow-y-auto">
            {chats.length === 0 ? <DropdownMenuItem disabled>No other chats</DropdownMenuItem> : null}
            {chats.map((chat) => (
              <DropdownMenuItem key={chat.id} data-attach-chat={chat.id} onSelect={() => attach(() => attachChat(session, chat.id))}>
                <span className="min-w-0 flex-1 truncate">{chat.title}</span>
                <span className="max-w-24 shrink-0 truncate text-xs text-muted-foreground">{workspaceName(chat.workspaceId)}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <SquareTerminal />
            Terminal
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="max-h-80 w-72 overflow-y-auto">
            {shells.length === 0 ? <DropdownMenuItem disabled>No terminals open</DropdownMenuItem> : null}
            {shells.map((terminal) => (
              <DropdownMenuItem
                key={terminal.id}
                data-attach-terminal={terminal.id}
                onSelect={() => attach(() => attachTerminal(session, terminal.id))}
              >
                <span className="min-w-0 flex-1 truncate">{terminal.customTitle || terminal.title}</span>
                <span className="max-w-24 shrink-0 truncate text-xs text-muted-foreground">
                  {terminal.inline ? 'Run in chat' : workspaceName(terminal.workspaceId)}
                </span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
