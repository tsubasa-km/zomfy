import { Archive, Moon, Pin } from 'lucide-react'
import { AgentQuestionIcon } from '@/components/AgentQuestionIcon'
import type { ChatSectionId } from '@/lib/chat-list'

// A group of threads is known by its mark and its place, not by a heading (docs/specs/ui-principles.md,
// docs/specs/turn-taking-states.md). The sidebar's groups and the dashboard's lanes share these marks;
// the group's name is the caller's tooltip.

export function TurnGroupMark({ id }: { id: ChatSectionId }) {
  switch (id) {
    case 'pinned':
      return <Pin className="size-3 shrink-0 text-muted-foreground/80" aria-hidden="true" />
    case 'needs-answer':
      return <AgentQuestionIcon className="size-3.5 shrink-0" />
    case 'your-turn':
      return <span aria-hidden="true" className="mx-[3px] block size-2 shrink-0 rounded-full bg-emerald-500 ring-2 ring-emerald-500/25" />
    case 'working':
      return <span aria-hidden="true" className="mx-[3px] block size-2 shrink-0 rounded-full border-[1.5px] border-yellow-500" />
    case 'quiet':
      return <Moon className="size-3 shrink-0 text-muted-foreground/70" aria-hidden="true" />
    case 'archived':
      return <Archive className="size-3 shrink-0 text-muted-foreground/70" aria-hidden="true" />
  }
}
