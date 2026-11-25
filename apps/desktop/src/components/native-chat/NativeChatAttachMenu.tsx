import { useMemo, useState } from 'react'
import { AtSign, ImagePlus, MessageSquare, Plug, Plus, Sparkles, SquareTerminal } from 'lucide-react'
import type { ChatCommand, ChatMcpServer } from '@zomfy/protocol'
import { Input } from '@/components/ui/input'
import { ConnectorIcon } from '@/components/right-sidebar/session-panel/ConnectorIcon'
import { useComposerConnectors } from '@/stores/composer-connectors-store'
import { matchSkills, offeredConnectors } from './composer-menu-items'
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
import { allWorkspaces, useStore, type HostId, type Session } from '@/session-store'
import { t } from '@/i18n/i18n'

/** Chats and terminals offered, newest first; the rest stay reachable by dragging their tabs in. */
const MENU_LIMIT = 30

/**
 * The composer's +: an image, a workspace file (the @ menu), a skill (as a leading `/skill`), one of
 * the chat's MCP servers (an `@mcp:` chip), or a snapshot of another chat or a terminal from any
 * workspace or host, inserted as a mention. A snapshot is saved for a chat on its host, so the
 * "New thread" tab (no `session` yet) offers what needs none.
 */
export function NativeChatAttachMenu({
  session,
  onPickImages,
  onMentionFile,
  skills = [],
  onPickSkill,
  connectors = null,
  onPickConnector
}: {
  session: Session | null
  onPickImages: () => void
  /** Absent where no workspace's files can be listed. */
  onMentionFile?: () => void
  /** The composer's skills; the Skill entry shows when there is one. */
  skills?: ChatCommand[]
  onPickSkill?: (name: string) => void
  /** The chat whose connected MCP servers are offered; null offers none. */
  connectors?: { sessionId: string; hostId: HostId } | null
  onPickConnector?: (server: ChatMcpServer) => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="ghost" size="icon-sm" aria-label={t('Attach')} data-native-chat-attach>
              <Plus className="size-4" />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="top" sideOffset={4}>
          {t('Attach')}
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
          {t('Image…')}
        </DropdownMenuItem>
        {onMentionFile ? (
          <DropdownMenuItem onSelect={onMentionFile}>
            <AtSign />
            {t('File in this workspace…')}
          </DropdownMenuItem>
        ) : null}
        {onPickSkill && skills.length > 0 ? <SkillItems skills={skills} onPick={onPickSkill} /> : null}
        {connectors && onPickConnector ? <ConnectorItems chat={connectors} wanted={open} onPick={onPickConnector} /> : null}
        {session ? <SnapshotItems session={session} /> : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** Skills, searchable by name and description; picking one starts the message with `/name`. */
function SkillItems({ skills, onPick }: { skills: ChatCommand[]; onPick: (name: string) => void }) {
  const [query, setQuery] = useState('')
  const shown = matchSkills(skills, query)
  return (
    <DropdownMenuSub onOpenChange={(subOpen) => !subOpen && setQuery('')}>
      <DropdownMenuSubTrigger data-attach-skills>
        <Sparkles />
        {t('Skill')}
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="max-h-80 w-80 overflow-y-auto">
        <div className="p-1">
          <Input
            autoFocus
            value={query}
            placeholder={t('Search skills')}
            aria-label={t('Search skills')}
            className="h-7 text-xs md:text-xs"
            data-attach-skill-search
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              // The menu's own keys move between rows; the rest are typing, not its type-ahead.
              if (event.key === 'Enter' && shown[0]) {
                event.preventDefault()
                onPick(shown[0].name)
                return
              }
              if (!['ArrowDown', 'ArrowUp', 'Escape', 'Tab'].includes(event.key)) event.stopPropagation()
            }}
          />
        </div>
        {shown.length === 0 ? <DropdownMenuItem disabled>{t('No matching skills')}</DropdownMenuItem> : null}
        {shown.map((skill) => (
          <DropdownMenuItem key={skill.name} data-attach-skill={skill.name} onSelect={() => onPick(skill.name)}>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-mono text-xs">/{skill.name}</span>
              {skill.description ? <span className="block truncate text-xs text-muted-foreground">{skill.description}</span> : null}
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  )
}

/** The chat's connected MCP servers, read when the menu opens; each goes in as an `@mcp:` chip. */
function ConnectorItems({
  chat,
  wanted,
  onPick
}: {
  chat: { sessionId: string; hostId: HostId }
  wanted: boolean
  onPick: (server: ChatMcpServer) => void
}) {
  const entry = useComposerConnectors(chat.sessionId, chat.hostId, wanted)
  const servers = offeredConnectors(entry.servers)
  // An agent that lists no servers (or none connected) gets no entry.
  if (entry.status !== 'loading' && servers.length === 0) return null
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger data-attach-connectors>
        <Plug />
        {t('Connector')}
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="max-h-80 w-72 overflow-y-auto">
        {servers.length === 0 ? <DropdownMenuItem disabled>{t('Loading connectors…')}</DropdownMenuItem> : null}
        {servers.map((server) => (
          <DropdownMenuItem key={server.name} data-attach-connector={server.name} onSelect={() => onPick(server)}>
            <ConnectorIcon server={server} className="size-4" />
            <span className="min-w-0 flex-1 truncate">{server.name}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  )
}

/** Other chats and terminals, each attached as a snapshot. */
function SnapshotItems({ session }: { session: Session }) {
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
    <>
      <DropdownMenuSub>
        <DropdownMenuSubTrigger>
          <MessageSquare />
          {t('Thread')}
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent className="max-h-80 w-72 overflow-y-auto">
          {chats.length === 0 ? <DropdownMenuItem disabled>{t('No other threads')}</DropdownMenuItem> : null}
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
          {t('Terminal')}
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent className="max-h-80 w-72 overflow-y-auto">
          {shells.length === 0 ? <DropdownMenuItem disabled>{t('No terminals open')}</DropdownMenuItem> : null}
          {shells.map((terminal) => (
            <DropdownMenuItem
              key={terminal.id}
              data-attach-terminal={terminal.id}
              onSelect={() => attach(() => attachTerminal(session, terminal.id))}
            >
              <span className="min-w-0 flex-1 truncate">{terminal.customTitle || terminal.title}</span>
              <span className="max-w-24 shrink-0 truncate text-xs text-muted-foreground">
                {terminal.inline ? t('Run in thread') : workspaceName(terminal.workspaceId)}
              </span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuSubContent>
      </DropdownMenuSub>
    </>
  )
}
