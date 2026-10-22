import { useRef, useState } from 'react'
import { EyeOff, PanelBottom, PanelTop } from 'lucide-react'
import { setSetting, type FloatingWorkspaceTriggerLocation } from '@/stores/settings-store'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'

// Orca's FloatingTerminalIconContextMenu: right-click the toggle to move it between the floating
// button and the status bar, or hide the floating workspace.

export function FloatingWorkspaceTriggerMenu({
  children,
  currentLocation,
  className,
  style
}: {
  children: React.ReactNode
  currentLocation: FloatingWorkspaceTriggerLocation
  className?: string
  style?: React.CSSProperties
}) {
  const [open, setOpen] = useState(false)
  const [point, setPoint] = useState({ x: 0, y: 0 })
  const frame = useRef<number | null>(null)
  const move =
    currentLocation === 'floating-button'
      ? { icon: <PanelBottom className="size-3.5" />, label: 'Move to Status Bar', location: 'status-bar' as const }
      : { icon: <PanelTop className="size-3.5" />, label: 'Move to Floating Button', location: 'floating-button' as const }

  return (
    <>
      <span
        className={className}
        style={style}
        data-floating-workspace-toggle
        onContextMenu={(event) => {
          // A cursor-anchored dropdown, as workspace cards use for right-click menus.
          event.preventDefault()
          event.stopPropagation()
          setPoint({ x: event.clientX, y: event.clientY })
          setOpen(false)
          if (frame.current !== null) cancelAnimationFrame(frame.current)
          frame.current = requestAnimationFrame(() => {
            frame.current = null
            setOpen(true)
          })
        }}
      >
        {children}
      </span>
      <DropdownMenu open={open} onOpenChange={setOpen} modal={false}>
        <DropdownMenuTrigger asChild>
          <button aria-hidden tabIndex={-1} className="pointer-events-none fixed size-px opacity-0" style={{ left: point.x, top: point.y }} />
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-52" sideOffset={0} align="start">
          <DropdownMenuItem className="whitespace-nowrap" data-floating-trigger-move onSelect={() => setSetting('floatingWorkspaceTriggerLocation', move.location)}>
            {move.icon}
            {move.label}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem className="whitespace-nowrap" data-floating-trigger-hide onSelect={() => setSetting('floatingWorkspaceEnabled', false)}>
            <EyeOff className="size-3.5" />
            Hide Floating Workspace
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  )
}
