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
  active: 'Active',
  working: 'Working',
  monitoring: 'Monitoring background tasks',
  permission: 'Needs permission',
  failed: 'Failed',
  interrupted: 'Interrupted',
  unconfirmed: 'Couldn’t confirm',
  done: 'Done',
  inactive: 'Inactive'
}

export function getWorktreeStatusLabel(status: WorktreeStatus): string {
  return STATUS_LABELS[status]
}
