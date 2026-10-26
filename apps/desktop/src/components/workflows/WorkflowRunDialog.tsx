import { useState } from 'react'
import { Play } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'

/** The Workflows page's own start: the task the run works on, as a chat message would give it. */
export function WorkflowRunDialog({
  name,
  unsaved,
  onStart,
  onClose
}: {
  name: string
  unsaved: boolean
  onStart: (task: string) => Promise<boolean>
  onClose: () => void
}) {
  const [task, setTask] = useState('')
  const [busy, setBusy] = useState(false)
  const start = async () => {
    if (!task.trim() || busy) return
    setBusy(true)
    try {
      if (await onStart(task.trim())) onClose()
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg" data-workflow-run-dialog>
        <DialogHeader>
          <DialogTitle>Run “{name}”</DialogTitle>
          <DialogDescription>
            Say what the run should do. Its card shows in the project's Lead chat, and you can follow it here.
            {unsaved ? ' Your changes are saved first.' : ''}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <Label htmlFor="workflow-run-task">Task</Label>
          <Textarea
            id="workflow-run-task"
            autoFocus
            rows={4}
            value={task}
            placeholder="e.g. Add a --verbose flag to the CLI and cover it with a test"
            onChange={(e) => setTask(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void start()
            }}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void start()} disabled={!task.trim() || busy} data-workflow-run-start>
            <Play className="size-3.5" />
            Run
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
