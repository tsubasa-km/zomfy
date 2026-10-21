import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { baseName } from './explorer-paths'

/** Shown only when the host has no trash for these entries (Orca confirms remote deletes the same way). */
export function PermanentDeleteDialog({
  pending,
  onConfirm,
  onClose
}: {
  pending: { paths: string[]; reason: string } | null
  onConfirm: () => void
  onClose: () => void
}) {
  const count = pending?.paths.length ?? 0
  const subject = count === 1 ? `"${baseName(pending!.paths[0]!)}"` : `${count} items`
  return (
    <Dialog open={pending !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Delete {subject} permanently?</DialogTitle>
          <DialogDescription className="break-words">
            {pending?.reason}. This permanently deletes {count === 1 ? 'it' : 'them'} and cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="destructive" autoFocus onClick={onConfirm}>
            Delete Permanently
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
