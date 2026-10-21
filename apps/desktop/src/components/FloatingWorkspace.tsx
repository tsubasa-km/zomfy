import { useEffect } from 'react'
import { Maximize2, Minimize2, Minus, PanelsTopLeft } from 'lucide-react'
import { setFloating, useStore } from '@/session-store'
import { WorkspaceTabs } from '@/components/WorkspaceTabs'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

// Follows Orca's floating workspace (FloatingTerminalToggleButton, FloatingTerminalPanelSurface,
// floating-terminal-panel-bounds): 920×560 at 24px/84px from the bottom-right, Ctrl/Cmd+Alt+A.

const isMac = navigator.userAgent.includes('Mac')

export function FloatingWorkspace() {
  const floatingId = useStore((s) => s.harness?.floatingWorkspaceId ?? null)
  const floatingPath = useStore(
    (s) => s.harness?.workspaces.find((w) => w.id === s.harness?.floatingWorkspaceId)?.path ?? ''
  )
  const { open, maximized } = useStore((s) => s.floating)
  const waiting = useStore((s) =>
    s.sessions.some((x) => x.workspaceId === floatingId && x.status === 'needs-you')
  )

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const mod = isMac ? e.metaKey : e.ctrlKey
      if (mod && e.altKey && e.code === 'KeyA') {
        e.preventDefault()
        setFloating({ open: !open })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  if (!floatingId) return null

  return (
    <>
      {!open && (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label="Open floating workspace"
              className="fixed right-6 bottom-6 z-[46] flex size-10 items-center justify-center rounded-full border border-border bg-card text-muted-foreground shadow-lg hover:text-foreground"
              onClick={() => setFloating({ open: true })}
            >
              <PanelsTopLeft className="size-4" />
              {waiting && (
                <span className="absolute top-1.5 right-1.5 size-2 rounded-full bg-agent-question" />
              )}
            </button>
          </TooltipTrigger>
          <TooltipContent side="left">
            Floating workspace ({isMac ? '⌘⌥A' : 'Ctrl+Alt+A'})
          </TooltipContent>
        </Tooltip>
      )}
      {open && (
        <div
          role="dialog"
          aria-label="Floating workspace"
          data-floating-workspace
          className={cn(
            'fixed z-[45] flex min-h-[280px] min-w-[420px] rounded-lg shadow-[0_10px_24px_rgba(0,0,0,0.18)]',
            maximized ? 'inset-x-3 top-9 bottom-9' : 'right-6 bottom-[84px] h-[560px] w-[920px]'
          )}
        >
          <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-lg border border-black/14 bg-card dark:border-white/10">
            <WorkspaceTabs
              workspaceId={floatingId}
              emptyHint={`Floating workspace in ${floatingPath}. Use + to start Claude here.`}
              trailing={
                <div className="flex shrink-0 items-center gap-0.5 px-1.5">
                  <WindowButton
                    label={maximized ? 'Restore' : 'Maximize'}
                    onClick={() => setFloating({ maximized: !maximized })}
                  >
                    {maximized ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
                  </WindowButton>
                  <WindowButton label="Minimize" onClick={() => setFloating({ open: false })}>
                    <Minus className="size-3.5" />
                  </WindowButton>
                </div>
              }
            />
          </div>
        </div>
      )}
    </>
  )
}

function WindowButton({
  label,
  onClick,
  children
}: {
  label: string
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="flex size-6 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
    >
      {children}
    </button>
  )
}
