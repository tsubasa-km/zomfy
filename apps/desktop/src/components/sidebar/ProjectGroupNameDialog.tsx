import { useEffect, useState } from 'react'
import { HARNESS_METHODS, type ProjectGroup } from '@acp-harness/protocol'
import { harnessRequest } from '@/daemon-connection'
import type { HostId } from '@/session-store'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { t } from '@/i18n/i18n'

// Orca's ProjectGroupNameDialog: name a new group (optionally with projects in it) or rename one.

export type GroupNameRequest =
  | { mode: 'create'; hostId: HostId; projectIds?: string[] }
  | { mode: 'rename'; hostId: HostId; group: ProjectGroup }

export function ProjectGroupNameDialog({ request, onClose }: { request: GroupNameRequest | null; onClose: () => void }) {
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setName(request?.mode === 'rename' ? request.group.name : '')
    setError(null)
  }, [request])

  async function save() {
    if (!request || !name.trim()) return
    try {
      if (request.mode === 'create') {
        await harnessRequest(
          HARNESS_METHODS.projectGroupCreate,
          { name, ...(request.projectIds ? { projectIds: request.projectIds } : {}) },
          request.hostId
        )
      } else {
        await harnessRequest(HARNESS_METHODS.projectGroupUpdate, { groupId: request.group.id, patch: { name } }, request.hostId)
      }
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <Dialog open={request !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-sm" data-group-name-dialog>
        <DialogHeader>
          <DialogTitle>{request?.mode === 'rename' ? t('Rename Group') : t('New Project Group')}</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            void save()
          }}
        >
          <Input autoFocus aria-label={t('Group name')} placeholder={t('Group name')} value={name} onChange={(e) => setName(e.target.value)} />
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t('Cancel')}
            </Button>
            <Button type="submit" disabled={!name.trim()}>
              {request?.mode === 'rename' ? t('Rename') : t('Create')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
