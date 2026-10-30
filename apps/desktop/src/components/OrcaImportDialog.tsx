import { useEffect, useState } from 'react'
import { FolderGit2, FolderOpen, Monitor, Server } from 'lucide-react'
import { HARNESS_METHODS, type OrcaProject } from '@acp-harness/protocol'
import { addProject, harnessRequest, hostForPath } from '@/daemon-connection'
import { LOCAL_HOST, allProjects, hostLabel, useStore } from '@/session-store'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { t } from '@/i18n/i18n'

type RowState = 'pending' | 'importing' | 'done' | { error: string }

/** Lists Orca's projects and adds the chosen ones on the host each lives on (WSL ones in WSL). */
export function OrcaImportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [projects, setProjects] = useState<OrcaProject[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [chosen, setChosen] = useState<Set<string>>(new Set())
  const [rows, setRows] = useState<Record<string, RowState>>({})
  const [busy, setBusy] = useState(false)
  const hosts = useStore((s) => s.hosts)

  useEffect(() => {
    if (!open) return
    setProjects(null)
    setLoadError(null)
    setRows({})
    void harnessRequest(HARNESS_METHODS.orcaProjects, {}, LOCAL_HOST)
      .then((list) => {
        setProjects(list)
        setChosen(new Set(list.map((p) => p.path)))
      })
      .catch((e: unknown) => setLoadError(e instanceof Error ? e.message : String(e)))
  }, [open])

  const alreadyAdded = new Set(allProjects(hosts).map((p) => `${p.hostId}|${p.path}`))

  async function runImport() {
    setBusy(true)
    for (const project of projects ?? []) {
      if (!chosen.has(project.path)) continue
      setRows((r) => ({ ...r, [project.path]: 'importing' }))
      try {
        await addProject(project.path)
        setRows((r) => ({ ...r, [project.path]: 'done' }))
      } catch (e) {
        setRows((r) => ({ ...r, [project.path]: { error: e instanceof Error ? e.message : String(e) } }))
      }
    }
    setBusy(false)
  }

  const allDone = projects !== null && [...chosen].every((path) => rows[path] === 'done')

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-h-[calc(100vh-2rem)] flex-col sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{t('Import from Orca')}</DialogTitle>
          <DialogDescription>
            {t(
              "Projects from Orca's active profile. Each is added on the machine it lives on: WSL folders open in that distro's daemon, so git and agents run inside WSL. Existing worktrees come along as workspaces."
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="scrollbar-sleek min-h-0 flex-1 space-y-1 overflow-y-auto py-2">
          {loadError && <p className="text-sm text-destructive">{loadError}</p>}
          {projects === null && !loadError && <p className="text-sm text-muted-foreground">{t('Reading Orca…')}</p>}
          {projects?.length === 0 && <p className="text-sm text-muted-foreground">{t('Orca has no projects.')}</p>}
          {projects?.map((project) => {
            const { hostId, path } = hostForPath(project.path)
            const added = alreadyAdded.has(`${hostId}|${path}`)
            const row = rows[project.path]
            return (
              <label
                key={project.path}
                data-orca-project={project.name}
                className="flex cursor-pointer items-start gap-2.5 rounded-md px-2 py-1.5 hover:bg-accent"
              >
                <Checkbox
                  className="mt-0.5"
                  checked={chosen.has(project.path)}
                  disabled={busy || added}
                  onCheckedChange={(v) => {
                    const next = new Set(chosen)
                    if (v === true) next.add(project.path)
                    else next.delete(project.path)
                    setChosen(next)
                  }}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 text-sm">
                    {project.kind === 'git' ? (
                      <FolderGit2 className="size-3.5 text-muted-foreground" />
                    ) : (
                      <FolderOpen className="size-3.5 text-muted-foreground" />
                    )}
                    <span className="font-medium">{project.name}</span>
                    <span className="ml-auto flex items-center gap-1 text-xs text-muted-foreground">
                      {hostId === LOCAL_HOST ? <Monitor className="size-3" /> : <Server className="size-3" />}
                      {hostLabel(hostId)}
                    </span>
                  </div>
                  <div className="truncate font-mono text-[11px] text-muted-foreground">{path}</div>
                  {added && !row && <div className="text-xs text-muted-foreground">{t('Already added')}</div>}
                  {row === 'importing' && <div className="text-xs text-muted-foreground">{t('Importing…')}</div>}
                  {row === 'done' && <div className="text-xs text-[var(--status-success)]">{t('Imported')}</div>}
                  {typeof row === 'object' && <div className="text-xs break-words text-destructive">{row.error}</div>}
                </div>
              </label>
            )
          })}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {allDone ? t('Close') : t('Cancel')}
          </Button>
          <Button disabled={busy || !projects || chosen.size === 0 || allDone} onClick={() => void runImport()}>
            {busy ? t('Importing…') : t('Import {n}', { n: chosen.size })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

