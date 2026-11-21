import type { SshConnectionTag } from '@zomfy/protocol'
import { sshTagLabel } from '@/lib/ssh-connections'
import { cn } from '@/lib/utils'

/** A connection's environment, coloured by how careful to be: production stands out. */
export function SshTagBadge({ tag, className }: { tag: SshConnectionTag; className?: string }) {
  return (
    <span
      data-ssh-tag-badge={tag}
      className={cn(
        'inline-flex shrink-0 items-center rounded px-1.5 text-[10px] leading-4 font-medium',
        tag === 'production'
          ? 'bg-destructive/15 text-destructive'
          : tag === 'staging'
            ? 'bg-status-warning/15 text-status-warning'
            : 'bg-muted text-muted-foreground',
        className
      )}
    >
      {sshTagLabel(tag)}
    </span>
  )
}
