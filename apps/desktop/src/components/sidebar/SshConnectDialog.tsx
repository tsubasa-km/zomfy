import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { SshHostPicker } from '@/components/ssh/SshHostPicker'
import { t } from '@/i18n/i18n'

/** The sidebar's "Connect SSH host…"; the host then appears as its own section, connecting. */
export function SshConnectDialog({
  open,
  onClose,
  onConnecting
}: {
  open: boolean
  onClose: () => void
  /** The host whose connection just started (Add Project selects it). */
  onConnecting?: (hostId: string) => void
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md" data-ssh-connect-dialog>
        <DialogHeader>
          <DialogTitle>{t('Connect SSH Host')}</DialogTitle>
          <DialogDescription>{t('Runs a daemon on the host and reaches it through an SSH tunnel.')}</DialogDescription>
        </DialogHeader>
        <SshHostPicker
          onConnect={(hostId) => {
            onConnecting?.(hostId)
            onClose()
          }}
        />
      </DialogContent>
    </Dialog>
  )
}
