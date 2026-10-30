import { t } from '@/i18n/i18n'
// Status vocabulary and labels from Orca's lib/worktree-status.ts (MIT); the title heuristics stay in Orca.
export type WorktreeStatus =
  | 'active'
  | 'working'
  | 'monitoring'
  | 'permission'
  | 'failed'
  | 'interrupted'
  | 'unconfirmed'
  | 'done'
  | 'inactive'

const STATUS_LABELS: Record<WorktreeStatus, string> = {
  active: t('Active'),
  working: t('Working'),
  monitoring: t('Monitoring background tasks'),
  permission: t('Needs permission'),
  failed: t('Failed'),
  interrupted: t('Interrupted'),
  unconfirmed: t('Couldn’t confirm'),
  done: t('Done'),
  inactive: t('Inactive')
}

export function getWorktreeStatusLabel(status: WorktreeStatus): string {
  return STATUS_LABELS[status]
}
