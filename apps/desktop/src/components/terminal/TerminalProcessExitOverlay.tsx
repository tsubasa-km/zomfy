import { RotateCw, X } from 'lucide-react'
import { Button } from '@/components/ui/button'

/** Ported from Orca's TerminalProcessExitOverlay: the output stays readable behind it. */
export function TerminalProcessExitOverlay({
  exitCode,
  onRestart,
  onClose
}: {
  exitCode: number
  onRestart: () => void
  onClose: () => void
}): React.JSX.Element {
  return (
    <div className="pointer-events-none absolute inset-0 z-40 flex items-end justify-center p-4">
      <div
        role="alert"
        data-terminal-exit-overlay
        className="pointer-events-auto flex w-full max-w-md flex-col gap-3 rounded-lg border border-border bg-card p-4 text-card-foreground shadow-xs"
      >
        <div className="space-y-1">
          <div className="text-sm font-medium text-foreground">Terminal exited</div>
          <div className="text-xs text-muted-foreground">
            The shell process ended with exit code {exitCode}. Its output is preserved.
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={onClose}>
            <X />
            Close
          </Button>
          <Button type="button" size="sm" onClick={onRestart} data-terminal-restart>
            <RotateCw />
            Restart
          </Button>
        </div>
      </div>
    </div>
  )
}
