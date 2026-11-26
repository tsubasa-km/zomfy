import { useState } from 'react'
import { FolderGit2, FolderOpen, Monitor, Server } from 'lucide-react'
import type { OrcaProject } from '@zomfy/protocol'
import { addProject, hostForPath } from '@/daemon-connection'
import { LOCAL_HOST, allProjects, hostLabel, useStore } from '@/session-store'
import { closeImport } from '@/stores/import-store'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { DialogFooter } from '@/components/ui/dialog'
import { t } from '@/i18n/i18n'

type RowState = 'importing' | 'done' | { error: string }

/** The Import dialog's Orca source: Orca's projects, each added on the host it lives on (WSL ones in WSL). */
export function OrcaProjectsPanel({ projects }: { projects: OrcaProject[] }) {
  const hosts = useStore((s) => s.hosts)
  const alreadyAdded = new Set(allProjects(hosts).map((p) => `${p.hostId}|${p.path}`))
  const isAdded = (project: OrcaProject) => {
    const { hostId, path } = hostForPath(project.path)
    return alreadyAdded.has(`${hostId}|${path}`)
  }
  const [chosen, setChosen] = useState<Set<string>>(() => new Set(projects.filter((p) => !isAdded(p)).map((p) => p.path)))
  const [rows, setRows] = useState<Record<string, RowState>>({})
  const [busy, setBusy] = useState(false)

  async function runImport() {
    setBusy(true)
    for (const project of projects) {
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

  const allDone = chosen.size > 0 && [...chosen].every((path) => rows[path] === 'done')

  return (
    <>
      <div className="scrollbar-sleek -mx-2 min-h-40 flex-1 space-y-0.5 overflow-y-auto px-2" data-import-orca-list>
        {projects.length === 0 && <p className="px-2 py-6 text-center text-sm text-muted-foreground">{t('Orca has no projects.')}</p>}
        {projects.map((project) => {
          const { hostId, path } = hostForPath(project.path)
          const added = isAdded(project)
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
                    <FolderGit2 className="size-3.5 shrink-0 text-muted-foreground" />
                  ) : (
                    <FolderOpen className="size-3.5 shrink-0 text-muted-foreground" />
                  )}
                  <span className="truncate font-medium">{project.name}</span>
                  <span className="ml-auto flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
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
        <Button variant="outline" onClick={closeImport}>
          {allDone ? t('Close') : t('Cancel')}
        </Button>
        <Button disabled={busy || chosen.size === 0 || allDone} onClick={() => void runImport()} data-import-run>
          {busy ? t('Importing…') : t('Import {n}', { n: chosen.size })}
        </Button>
      </DialogFooter>
    </>
  )
}
