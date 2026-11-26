import { useState } from 'react'
import { Globe, Puzzle, SquareTerminal } from 'lucide-react'
import type { ChatMcpServer } from '@zomfy/protocol'
import { connectorIcon, letterAvatar } from '@/lib/connector-icons'
import { useFavicon } from '@/stores/favicon-store'
import { cn } from '@/lib/utils'
import appIconUrl from '../../../../src-tauri/icons/32x32.png'

// A connector row's icon, like the Claude app's: the service's site icon, a generic one for its
// kind, or the server's first letter.

const BOX = 'flex size-5 shrink-0 items-center justify-center overflow-hidden rounded-[5px]'

export function ConnectorIcon({ server, className }: { server: ChatMcpServer; className?: string }) {
  const icon = connectorIcon(server)
  const favicon = useFavicon(icon.kind === 'site' ? icon.domain : null)
  const [broken, setBroken] = useState(false)
  const mark = (() => {
    if (icon.kind === 'harness') return <img src={appIconUrl} alt="" className="size-5" draggable={false} />
    if (icon.kind === 'chrome') return <ChromeMark />
    if (icon.kind === 'site' && favicon && !broken)
      return <img src={favicon} alt="" className="size-4 object-contain" draggable={false} onError={() => setBroken(true)} />
    if (icon.kind === 'stdio') return <SquareTerminal className="size-3.5 text-muted-foreground" />
    if (icon.kind === 'plugin') return <Puzzle className="size-3.5 text-muted-foreground" />
    if (icon.kind === 'remote') return <Globe className="size-3.5 text-muted-foreground" />
    // A site icon still on its way, or none to be had: the letter.
    const { letter, hue } = letterAvatar(server.name)
    return (
      <span className="text-[11px] font-semibold text-white" style={{ backgroundColor: `hsl(${hue} 45% 45%)` }} data-connector-letter>
        {letter}
      </span>
    )
  })()
  const site = icon.kind === 'site' && !!favicon && !broken
  const letter = icon.kind === 'letter' || (icon.kind === 'site' && !site)
  return (
    <span
      className={cn(
        BOX,
        // Site icons are drawn for a light page; a white tile keeps dark ones readable in the dark theme.
        (site || icon.kind === 'chrome') && 'bg-white',
        (icon.kind === 'stdio' || icon.kind === 'plugin' || icon.kind === 'remote') && 'bg-muted',
        letter && '[&>span]:flex [&>span]:size-full [&>span]:items-center [&>span]:justify-center',
        className
      )}
      data-connector-icon={letter ? 'letter' : icon.kind}
      aria-hidden
    >
      {mark}
    </span>
  )
}

/** Chrome's mark, drawn here: the Claude in Chrome server has no site of its own to take an icon from. */
function ChromeMark() {
  return (
    <svg viewBox="0 0 48 48" className="size-4" aria-hidden>
      <path fill="#db4437" d="M24 24 6.68 14A20 20 0 0 1 41.32 14Z" />
      <path fill="#ffcd40" d="M24 24 41.32 14A20 20 0 0 1 24 44Z" />
      <path fill="#0f9d58" d="M24 24 24 44A20 20 0 0 1 6.68 14Z" />
      <circle cx="24" cy="24" r="9" fill="#fff" />
      <circle cx="24" cy="24" r="7.2" fill="#4285f4" />
    </svg>
  )
}
