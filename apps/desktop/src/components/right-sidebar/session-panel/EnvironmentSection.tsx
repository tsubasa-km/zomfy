import { Folder, GitBranch, Monitor, type LucideIcon } from 'lucide-react'
import { allProjects, allWorkspaces, hostLabel, useStore } from '@/session-store'
import { projectLabel } from '@/components/sidebar/workspace-visibility'
import { Section } from './panel-parts'
import { t } from '@/i18n/i18n'

// Where the chat in front runs: the host, the project and its folder, the branch and whether the
// folder is the project's own checkout or a worktree of it.

function Row({ icon: Icon, label, value, detail }: { icon: LucideIcon; label: string; value: string; detail?: string }) {
  return (
    <div className="flex items-start gap-2" title={detail ? `${value}\n${detail}` : value}>
      <Icon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="min-w-0 flex-1 truncate">{value}</span>
          <span className="shrink-0 text-[11px] text-muted-foreground">{label}</span>
        </div>
        {detail && <div className="truncate font-mono text-[11px] text-muted-foreground" data-session-env-path>{detail}</div>}
      </div>
    </div>
  )
}

export function EnvironmentSection({ workspaceId }: { workspaceId: string }) {
  // Primitives only: allWorkspaces and allProjects build new objects on every call.
  const hostId = useStore((s) => allWorkspaces(s).find((w) => w.id === workspaceId)?.hostId ?? null)
  const path = useStore((s) => allWorkspaces(s).find((w) => w.id === workspaceId)?.path ?? '')
  const branch = useStore((s) => allWorkspaces(s).find((w) => w.id === workspaceId)?.branch ?? null)
  const primary = useStore((s) => allWorkspaces(s).find((w) => w.id === workspaceId)?.isPrimary ?? true)
  const scratch = useStore((s) => allWorkspaces(s).find((w) => w.id === workspaceId)?.scratch === true)
  const projectId = useStore((s) => allWorkspaces(s).find((w) => w.id === workspaceId)?.projectId ?? null)
  const project = useStore((s) => {
    const found = allProjects(s.hosts).find((p) => p.id === projectId && p.hostId === hostId)
    return found ? projectLabel(found) : null
  })
  if (!hostId) return null
  return (
    <Section title={t('Environment')}>
      <div className="space-y-1.5" data-session-environment>
        <Row icon={Monitor} label={t('Host')} value={hostLabel(hostId)} />
        <Row icon={Folder} label={scratch ? t('Quick thread') : t('Project')} value={project ?? (scratch ? t('No project') : t('Folder'))} detail={path} />
        {!scratch && (
          <Row
            icon={GitBranch}
            label={primary ? t('Main checkout') : t('Worktree')}
            value={branch ?? (projectId ? t('detached') : t('Not a git checkout'))}
          />
        )}
      </div>
    </Section>
  )
}
