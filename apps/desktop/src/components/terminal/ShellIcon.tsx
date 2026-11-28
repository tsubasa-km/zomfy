import { Monitor, Server } from 'lucide-react'
import { cn } from '@/lib/utils'

// Each shell and host its own small mark, so rows are told apart before they are read
// (docs/specs/panes-as-workspaces.md). Inline drawings in the shells' own colours, no icon package.

/** A rounded square in `fill` with a glyph drawn in white over it. */
function Tile({ fill, children, className }: { fill: string; children: React.ReactNode; className?: string }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden className={cn('size-4 shrink-0', className)}>
      <rect x="0.5" y="0.5" width="15" height="15" rx="3" fill={fill} />
      {children}
    </svg>
  )
}

/** PowerShell's chevron and underscore. */
const chevron = (
  <>
    <path d="M4 4.5 8.2 8 4 11.5" fill="none" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M8.6 11.5h3.6" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" />
  </>
)

/** The mark of a shell the daemon detects (`pwsh`, `powershell`, `cmd`, `git-bash`, a login shell). */
export function ShellIcon({ shellId, label, className }: { shellId: string; label?: string; className?: string }) {
  const name = `${shellId} ${label ?? ''}`.toLowerCase()
  if (shellId === 'pwsh') return <Tile fill="#2671be" className={className}>{chevron}</Tile>
  if (shellId === 'powershell' || name.includes('powershell')) return <Tile fill="#012456" className={className}>{chevron}</Tile>
  if (shellId === 'cmd' || name.includes('command prompt'))
    return (
      <Tile fill="#1f1f1f" className={className}>
        <text x="8" y="10.6" textAnchor="middle" fontSize="6.4" fontFamily="Consolas, monospace" fontWeight="700" fill="#fff">
          C:\
        </text>
      </Tile>
    )
  if (shellId === 'git-bash' || name.includes('git'))
    return (
      <svg viewBox="0 0 16 16" aria-hidden className={cn('size-4 shrink-0', className)}>
        <rect x="2.3" y="2.3" width="11.4" height="11.4" rx="1.6" transform="rotate(45 8 8)" fill="#f05032" />
        <circle cx="6.4" cy="6.6" r="1" fill="#fff" />
        <circle cx="9.6" cy="9.6" r="1" fill="#fff" />
        <circle cx="6.4" cy="10" r="1" fill="#fff" />
        <path d="M6.4 6.6v3.4M6.4 6.6l3.2 3" stroke="#fff" strokeWidth="0.9" />
      </svg>
    )
  // A login shell (bash, zsh, fish…) on a Linux or macOS host.
  return (
    <Tile fill="#2e3440" className={className}>
      <text x="8" y="11.2" textAnchor="middle" fontSize="8.5" fontFamily="Consolas, monospace" fontWeight="700" fill="#a3e635">
        $
      </text>
    </Tile>
  )
}

/** A penguin's head, for a WSL or Linux host. */
function Penguin({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden className={cn('size-4 shrink-0', className)}>
      <ellipse cx="8" cy="9" rx="5.2" ry="6" fill="#1f1f1f" />
      <ellipse cx="8" cy="10.4" rx="3.4" ry="4" fill="#fafafa" />
      <circle cx="6.5" cy="6" r="0.9" fill="#fafafa" />
      <circle cx="9.5" cy="6" r="0.9" fill="#fafafa" />
      <path d="M6.6 7.6h2.8L8 9z" fill="#f5b400" />
    </svg>
  )
}

/** The mark of a host: this computer, a WSL or Linux one, or a remote server. */
export function HostIcon({ hostId, platform, className }: { hostId: string; platform?: string; className?: string }) {
  if (hostId === 'local') return <Monitor className={cn('size-4 shrink-0', className)} />
  if (hostId.startsWith('wsl:') || platform === 'linux') return <Penguin className={className} />
  return <Server className={cn('size-4 shrink-0', className)} />
}
