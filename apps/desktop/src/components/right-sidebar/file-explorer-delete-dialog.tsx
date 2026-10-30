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
import { t } from '@/i18n/i18n'

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
  return (
    <Dialog open={pending !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {count === 1
              ? t('Delete "{name}" permanently?', { name: baseName(pending!.paths[0]!) })
              : t('Delete {n} items permanently?', { n: count })}
          </DialogTitle>
          <DialogDescription className="break-words">
            {pending?.reason}.{' '}
            {count === 1
              ? t('This permanently deletes it and cannot be undone.')
              : t('This permanently deletes them and cannot be undone.')}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t('Cancel')}
          </Button>
          <Button variant="destructive" autoFocus onClick={onConfirm}>
            {t('Delete Permanently')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
