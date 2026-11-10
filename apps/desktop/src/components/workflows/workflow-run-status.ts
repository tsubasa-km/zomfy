import type { WorkflowRun } from '@acp-harness/protocol'
import { t } from '@/i18n/i18n'

// How a run's status reads, wherever a run is listed.

export const RUN_STATUS_LABELS: Record<WorkflowRun['status'], string> = {
  running: t('Running'),
  waiting: t('Waiting for you'),
  done: t('Done'),
  failed: t('Failed'),
  stopped: t('Stopped')
}

export const RUN_STATUS_CLASSES: Record<WorkflowRun['status'], string> = {
  running: 'text-primary',
  waiting: 'text-agent-question-text',
  done: 'text-status-success',
  failed: 'text-destructive',
  stopped: 'text-muted-foreground'
}
