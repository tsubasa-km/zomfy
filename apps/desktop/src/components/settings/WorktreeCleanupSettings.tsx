import { useEffect, useState } from 'react'
import { DEFAULT_WORKTREE_CLEANUP_POLICY, HARNESS_METHODS, type CleanupRun, type WorktreeCleanupPolicy } from '@zomfy/protocol'
import { harnessRequest } from '@/daemon-connection'
import { updateHostSettings, useHostSettings } from '@/stores/host-settings-store'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { formatBytes } from '@/components/sidebar/workspace-size'
import { SettingsRow } from './settings-form-controls'
import { t } from '@/i18n/i18n'

// A host's automatic worktree cleanup (spec worktree-skills-and-storage B5): merged worktrees are
// deleted after a day by default, idle ones can lose their dependencies and build output. A project
// can turn deletion off in its own settings.

const DAY_CHOICES = [1, 3, 7, 14, 30]

export function WorktreeCleanupRows({ hostId }: { hostId: string }) {
  const settings = useHostSettings(hostId)
  const policy: WorktreeCleanupPolicy = { ...DEFAULT_WORKTREE_CLEANUP_POLICY, ...settings?.worktreeCleanup }
  const [lastRun, setLastRun] = useState<CleanupRun | null>(null)

  useEffect(() => {
    // An older daemon has no cleanup: nothing is shown under the rows.
    void harnessRequest(HARNESS_METHODS.cleanupLastRun, {}, hostId).then(setLastRun, () => undefined)
  }, [hostId])

  const update = (patch: Partial<WorktreeCleanupPolicy>) => void updateHostSettings(hostId, { worktreeCleanup: { ...policy, ...patch } })

  return (
    <>
      <SettingsRow
        label={t('Delete merged worktrees')}
        description={
          <>
            {t('Deletes a worktree, and its branch, once its work has been merged for this long and nothing ran in it. Uncommitted or unpushed work, a running chat or terminal, or a pin keeps it; its chats move to the main checkout.')}
            {lastRun && <span className="block pt-1">{lastRunLabel(lastRun)}</span>}
          </>
        }
        keywords={['worktree', 'cleanup', 'merged', 'delete', 'disk', 'space']}
        control={
          <div className="flex items-center gap-2">
            <DaysSelect value={policy.deleteMergedAfterDays} disabled={!settings || !policy.deleteMerged} label={t('Delete merged worktrees')} onChange={(n) => update({ deleteMergedAfterDays: n })} />
            <Switch checked={policy.deleteMerged} disabled={!settings} aria-label={t('Delete merged worktrees')} onCheckedChange={(on) => update({ deleteMerged: on })} data-setting="cleanup-delete-merged" />
          </div>
        }
      />
      <SettingsRow
        label={t('Free space in idle worktrees')}
        description={t("Deletes node_modules and build output (target, dist) of worktrees nobody used for this long; files and git state stay. The next turn there runs the setup script first.")}
        keywords={['worktree', 'cleanup', 'node_modules', 'target', 'disk', 'space', 'idle']}
        control={
          <div className="flex items-center gap-2">
            <DaysSelect value={policy.freeIdleAfterDays} disabled={!settings || !policy.freeIdle} label={t('Free space in idle worktrees')} onChange={(n) => update({ freeIdleAfterDays: n })} />
            <Switch checked={policy.freeIdle} disabled={!settings} aria-label={t('Free space in idle worktrees')} onCheckedChange={(on) => update({ freeIdle: on })} data-setting="cleanup-free-idle" />
          </div>
        }
      />
      <SettingsRow
        label={t('Keep pinned worktrees')}
        keywords={['worktree', 'cleanup', 'pin']}
        control={<Switch checked={policy.keepPinned} disabled={!settings} aria-label={t('Keep pinned worktrees')} onCheckedChange={(on) => update({ keepPinned: on })} />}
      />
    </>
  )
}

function DaysSelect({ value, onChange, disabled, label }: { value: number; onChange: (n: number) => void; disabled: boolean; label: string }) {
  const choices = DAY_CHOICES.includes(value) ? DAY_CHOICES : [...DAY_CHOICES, value].sort((a, b) => a - b)
  return (
    <Select value={String(value)} disabled={disabled} onValueChange={(v) => onChange(Number(v))}>
      <SelectTrigger size="sm" className="min-w-[110px]" aria-label={t('{label}: after', { label })}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {choices.map((n) => (
          <SelectItem key={n} value={String(n)}>
            {n === 1 ? t('After 1 day') : t('After {n} days', { n })}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function lastRunLabel(run: CleanupRun): string {
  const when = new Date(run.at).toLocaleString()
  if (run.errors.length > 0) return t('Last run {when}: deleted {deleted}, freed {freed} ({size}); {n} could not be cleaned up.', { when, deleted: run.deleted, freed: run.freed, size: formatBytes(run.freedBytes), n: run.errors.length })
  return t('Last run {when}: deleted {deleted}, freed {freed} ({size}).', { when, deleted: run.deleted, freed: run.freed, size: formatBytes(run.freedBytes) })
}
