import { useEffect, useState } from 'react'
import { isTauri } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
import { HARNESS_METHODS } from '@acp-harness/protocol'
import { harnessRequest, hostForPath, isSshHost } from '@/daemon-connection'
import { LOCAL_HOST, useStore, type HostId } from '@/session-store'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

// Orca's Add Project dialog steps "Clone from URL" (AddRepoCloneStep) and "Create new" (AddRepoCreateStep),
// plus "Add by path" for hosts whose folders no local picker can browse (SSH).

export type AddRepoMode = 'clone' | 'create' | 'path'

const fieldLabel = 'text-xs font-medium text-muted-foreground'
const LAST_PARENT_KEY = 'acp-harness.add-repo.parent'

function readLastParent(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(LAST_PARENT_KEY) ?? '{}')
  } catch {
    return {}
  }
}

export function AddRepoDialog({ mode, onClose }: { mode: AddRepoMode | null; onClose: () => void }) {
  const hosts = useStore((s) => s.hosts)
  const connected = Object.values(hosts).filter((h) => h.connection.kind === 'connected')
  const [hostId, setHostId] = useState<HostId>(LOCAL_HOST)
  const firstRemote = connected.find((h) => h.id !== LOCAL_HOST)?.id

  useEffect(() => {
    if (mode === 'path' && firstRemote) setHostId(firstRemote)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only as the dialog opens; the user may then pick another host
  }, [mode])
  const [url, setUrl] = useState('')
  const [parent, setParent] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setUrl('')
    setName('')
    setError(null)
    setParent(readLastParent()[hostId] ?? '')
  }, [mode, hostId])

  async function browse() {
    const folder = await open({ directory: true, title: mode === 'clone' ? 'Clone into' : 'Create in' })
    if (typeof folder !== 'string') return
    const picked = hostForPath(folder)
    setHostId(picked.hostId)
    setParent(picked.path)
  }

  async function submit() {
    setBusy(true)
    setError(null)
    try {
      if (mode === 'path') {
        await harnessRequest(HARNESS_METHODS.projectAdd, { path: parent.trim() }, hostId)
      } else if (mode === 'clone') {
        await harnessRequest(HARNESS_METHODS.projectClone, { url, parentPath: parent, ...(name.trim() ? { name } : {}) }, hostId)
      } else {
        await harnessRequest(HARNESS_METHODS.projectCreateRepo, { parentPath: parent, name }, hostId)
      }
      try {
        localStorage.setItem(LAST_PARENT_KEY, JSON.stringify({ ...readLastParent(), [hostId]: parent }))
      } catch {
        // Only a convenience.
      }
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={mode !== null} onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="sm:max-w-md" data-add-repo-dialog={mode ?? undefined}>
        <DialogHeader>
          <DialogTitle>{mode === 'clone' ? 'Clone Repository' : mode === 'path' ? 'Add Project on Host' : 'Create Repository'}</DialogTitle>
          <DialogDescription>
            {mode === 'clone'
              ? 'Clones a git repository and adds it as a project.'
              : mode === 'path'
                ? 'Adds a folder or git repository that already exists on the host, by its path there.'
                : 'Creates a folder with a new git repository and adds it as a project.'}
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
        >
          {connected.length > 1 && (
            <div className="space-y-1.5">
              <Label className={fieldLabel}>Host</Label>
              <Select value={hostId} onValueChange={setHostId}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {connected.map((h) => (
                    <SelectItem key={h.id} value={h.id}>
                      {h.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {mode === 'clone' && (
            <div className="space-y-1.5">
              <Label htmlFor="repo-url" className={fieldLabel}>
                Repository URL
              </Label>
              <Input
                id="repo-url"
                autoFocus
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://github.com/owner/repo.git"
                className="font-mono text-xs"
              />
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="repo-parent" className={fieldLabel}>
              {mode === 'clone' ? 'Clone into folder' : mode === 'path' ? 'Folder path on the host' : 'Create in folder'}
            </Label>
            <div className="flex gap-2">
              <Input
                id="repo-parent"
                value={parent}
                onChange={(e) => setParent(e.target.value)}
                placeholder={mode === 'path' ? '/home/me/src/project' : 'Folder on the host'}
                autoFocus={mode === 'path'}
                className="font-mono text-xs"
              />
              {isTauri() && !isSshHost(hostId) && (
                <Button type="button" variant="outline" onClick={() => void browse()}>
                  Browse…
                </Button>
              )}
            </div>
          </div>
          {mode !== 'path' && (
          <div className="space-y-1.5">
            <Label htmlFor="repo-name" className={fieldLabel}>
              {mode === 'clone' ? 'Folder name' : 'Name'}
            </Label>
            <Input
              id="repo-name"
              autoFocus={mode === 'create'}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={mode === 'clone' ? 'Defaults to the repository name' : 'my-project'}
            />
          </div>
          )}
          {error && <p className="text-sm break-words text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={busy || !parent.trim() || (mode === 'clone' ? !url.trim() : mode === 'create' && !name.trim())}
            >
              {busy
                ? mode === 'clone' ? 'Cloning…' : mode === 'path' ? 'Adding…' : 'Creating…'
                : mode === 'clone' ? 'Clone' : mode === 'path' ? 'Add' : 'Create'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
