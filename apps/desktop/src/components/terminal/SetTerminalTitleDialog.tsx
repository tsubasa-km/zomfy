import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { t } from '@/i18n/i18n'

/** "Set Title…": a title of the user's own that OSC titles no longer replace. */
export function SetTerminalTitleDialog({
  initial,
  onSave,
  onCancel
}: {
  initial: string
  onSave: (title: string | null) => void
  onCancel: () => void
}) {
  const [title, setTitle] = useState(initial)
  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="max-w-sm" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle className="text-sm">{t('Set Terminal Title')}</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            onSave(title.trim() || null)
          }}
          className="space-y-4"
        >
          <Input
            autoFocus
            aria-label={t('Terminal title')}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onFocus={(e) => e.target.select()}
            placeholder={t('Leave empty to follow the running program')}
          />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onCancel}>
              {t('Cancel')}
            </Button>
            <Button type="submit">{t('Save')}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
