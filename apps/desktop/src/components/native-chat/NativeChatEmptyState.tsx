import { useEffect, useState } from 'react'
import { GitBranch, History, MessageSquare } from 'lucide-react'
import { HARNESS_METHODS, type PastConversation } from '@acp-harness/protocol'
import { harnessRequest } from '@/daemon-connection'
import { selectSession, type Session } from '@/session-store'
import { resumeConversation } from '@/chat-actions'

function relativeTime(ms: number): string {
  const minutes = Math.round((Date.now() - ms) / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

/** Orca's empty chat, with this folder's earlier Claude conversations to pick up again. */
export function NativeChatEmptyState({ session }: { session: Session }) {
  const [history, setHistory] = useState<PastConversation[] | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    harnessRequest(HARNESS_METHODS.sessionHistory, { workspaceId: session.workspaceId }, session.hostId)
      .then((list) => live && setHistory(list))
      .catch((error) => live && setFailed(String(error)))
    return () => {
      live = false
    }
  }, [session.workspaceId, session.hostId])
  const others = history?.filter((c) => c.openSessionId !== session.id) ?? []

  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-3 p-6 text-center">
      <div className="flex size-12 items-center justify-center rounded-full bg-accent text-accent-foreground">
        <MessageSquare className="size-6" />
      </div>
      <p className="text-sm font-medium text-chat-foreground-strong">Start a conversation with Claude</p>
      <p className="max-w-sm text-xs text-balance text-chat-foreground-faint">
        Type / for commands, @ to mention a file, or paste an image.
      </p>
      {others.length > 0 ? (
        <div className="mt-4 w-full max-w-md text-left" data-native-chat-history>
          <div className="flex items-center gap-1.5 px-2 pb-1 text-2xs font-semibold tracking-[0.05em] text-muted-foreground uppercase">
            <History className="size-3" aria-hidden />
            Recent conversations
          </div>
          <ul className="scrollbar-sleek max-h-72 overflow-y-auto">
            {others.slice(0, 30).map((c) => (
              <li key={c.claudeSessionId}>
                <button
                  type="button"
                  data-claude-session={c.claudeSessionId}
                  onClick={() =>
                    c.openSessionId
                      ? selectSession(c.openSessionId)
                      : void resumeConversation(session.workspaceId, c.claudeSessionId, session.hostId)
                  }
                  className="flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-chat-foreground hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                >
                  <span className="min-w-0 flex-1 truncate">{c.title}</span>
                  {c.gitBranch ? (
                    <span className="flex max-w-32 shrink-0 items-center gap-1 text-xs text-muted-foreground">
                      <GitBranch className="size-3 shrink-0" aria-hidden />
                      <span className="truncate">{c.gitBranch}</span>
                    </span>
                  ) : null}
                  <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                    {c.openSessionId ? 'Open' : relativeTime(c.lastModified)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : failed ? (
        <p className="text-xs text-chat-foreground-faint">Couldn't list earlier conversations</p>
      ) : null}
    </div>
  )
}
