import { useState } from 'react'
import { ArrowLeft, CalendarClock, MessageSquare, Pencil, Play, Plus, Trash2 } from 'lucide-react'
import {
  HARNESS_METHODS,
  chatAgentLabel,
  automationScheduleFields,
  type AutomationRunStatus,
  type AutomationTrigger
} from '@acp-harness/protocol'
import { harnessRequest } from '@/daemon-connection'
import { allProjects, allWorkspaces, getState, selectSession, useStore } from '@/session-store'
import {
  allAutomations,
  automationRuns,
  selectAutomation,
  setAutomationsPageOpen,
  useAutomationState,
  useLoadAutomations,
  type HostedAutomation,
  type HostedAutomationRun
} from '@/stores/automation-store'
import { AutomationEditorDialog } from './AutomationEditorDialog'
import { TuiAgentIcon } from '@/components/terminal/TuiAgentIcon'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import { t } from '@/i18n/i18n'

// Orca's Automations page (AutomationsPage.tsx, AutomationsListPanel, AutomationsDetailPane,
// AutomationRunHistory): the list on the left, the selected automation and its runs on the right.

const STATUS_LABEL: Record<AutomationRunStatus, string> = {
  dispatched: t('Running'),
  completed: t('Completed'),
  failed: t('Failed'),
  dispatch_failed: t('Could not start'),
  skipped_missed: t('Skipped (missed)'),
  skipped_unavailable: t('Skipped (workspace gone)')
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const

/** The protocol's describeAutomationSchedule, in the window's language. */
function describeSchedule(rrule: string): string {
  const fields = automationScheduleFields(rrule)
  if (!fields) return t('Custom schedule')
  const minute = String(fields.minute).padStart(2, '0')
  const time = `${String(fields.hour).padStart(2, '0')}:${minute}`
  if (fields.preset === 'hourly') return t('Hourly at :{minute}', { minute })
  if (fields.preset === 'daily') return t('Daily at {time}', { time })
  if (fields.preset === 'weekdays') return t('Weekdays at {time}', { time })
  return t('{day}s at {time}', { day: t(DAY_NAMES[fields.dayOfWeek] ?? 'Monday'), time })
}

export function triggerLabel(trigger: AutomationTrigger, names: Map<string, string>): string {
  if (trigger.kind === 'schedule') return describeSchedule(trigger.rrule)
  if (trigger.kind === 'workspace-created') {
    return t('When a workspace is created in {project}', {
      project: trigger.projectId ? (names.get(trigger.projectId) ?? t('a removed project')) : t('any project')
    })
  }
  return t('When an agent finishes in {workspace}', {
    workspace: trigger.workspaceId ? (names.get(trigger.workspaceId) ?? t('a removed workspace')) : t('any workspace')
  })
}

function formatTime(ms: number | null): string {
  if (ms === null) return '—'
  return new Date(ms).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function useNames(): Map<string, string> {
  const hosts = useStore((s) => s.hosts)
  return new Map([
    ...allWorkspaces({ hosts }).map((w): [string, string] => [w.id, w.displayName || w.name]),
    ...allProjects(hosts).map((p): [string, string] => [p.id, p.displayName || p.name])
  ])
}

export function AutomationsPage() {
  useLoadAutomations()
  const byHost = useAutomationState((s) => s.byHost)
  const selectedId = useAutomationState((s) => s.selectedId)
  const automations = allAutomations(byHost)
  const selected = automations.find((a) => a.id === selectedId) ?? automations[0] ?? null
  const [editor, setEditor] = useState<{ open: boolean; existing: HostedAutomation | null }>({ open: false, existing: null })
  const names = useNames()

  const defaultWorkspace = () => {
    const id = getState().activeWorkspaceId
    const workspace = id ? allWorkspaces().find((w) => w.id === id) : null
    return workspace ? { id: workspace.id, hostId: workspace.hostId } : null
  }

  return (
    <div
      className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background"
      data-automations-page
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || event.defaultPrevented || editor.open) return
        const target = event.target
        if (!(target instanceof Node) || !event.currentTarget.contains(target)) return
        setAutomationsPageOpen(false)
      }}
    >
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-3">
        <Button size="icon-xs" variant="ghost" aria-label={t('Back')} onClick={() => setAutomationsPageOpen(false)}>
          <ArrowLeft />
        </Button>
        <CalendarClock className="size-4 text-muted-foreground" />
        <h1 className="text-[13px] font-semibold">{t('Automations')}</h1>
        <span className="text-[11px] text-muted-foreground">{t("Run on each host's daemon, even with this window closed")}</span>
        <Button
          size="sm"
          className="ml-auto"
          data-automation-new
          onClick={() => setEditor({ open: true, existing: null })}
        >
          <Plus />
          {t('New automation')}
        </Button>
      </div>
      <div className="flex min-h-0 flex-1">
        <div className="scrollbar-sleek flex w-[320px] shrink-0 flex-col gap-1 overflow-y-auto border-r border-border p-2">
          {automations.length === 0 ? (
            <p className="px-2 py-6 text-center text-xs text-muted-foreground">
              {t('No automations yet. Create one to run a prompt on a schedule or when something happens.')}
            </p>
          ) : null}
          {automations.map((automation) => (
            <AutomationRow
              key={automation.id}
              automation={automation}
              selected={automation.id === selected?.id}
              label={triggerLabel(automation.trigger, names)}
            />
          ))}
        </div>
        <div className="scrollbar-sleek min-w-0 flex-1 overflow-y-auto">
          {selected ? (
            <AutomationDetail
              automation={selected}
              runs={automationRuns(byHost, selected)}
              names={names}
              onEdit={() => setEditor({ open: true, existing: selected })}
            />
          ) : null}
        </div>
      </div>
      <AutomationEditorDialog
        open={editor.open}
        existing={editor.existing}
        defaultWorkspace={editor.open && !editor.existing ? defaultWorkspace() : null}
        onOpenChange={(open) => setEditor((e) => ({ ...e, open }))}
      />
    </div>
  )
}

async function setEnabled(automation: HostedAutomation, enabled: boolean): Promise<void> {
  await harnessRequest(HARNESS_METHODS.automationUpdate, { id: automation.id, patch: { enabled } }, automation.hostId)
}

function AutomationRow({
  automation,
  selected,
  label
}: {
  automation: HostedAutomation
  selected: boolean
  label: string
}) {
  const hostLabel = useStore((s) => s.hosts[automation.hostId]?.label ?? automation.hostId)
  return (
    <div
      data-automation-row={automation.id}
      className={cn(
        'flex items-start gap-2 rounded-md px-2 py-2 transition-colors',
        selected ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50'
      )}
    >
      <button type="button" className="flex min-w-0 flex-1 flex-col gap-0.5 text-left" onClick={() => selectAutomation(automation.id)}>
        <span className="flex min-w-0 items-center gap-1.5 text-[13px] font-medium">
          <TuiAgentIcon agent={automation.agent} size={13} />
          <span className="truncate">{automation.name}</span>
        </span>
        <span className="truncate text-[11px] text-muted-foreground">{label}</span>
        <span className="truncate text-[11px] text-muted-foreground">
          {hostLabel}
          {automation.enabled && automation.nextRunAt !== null ? t(' · next {time}', { time: formatTime(automation.nextRunAt) }) : ''}
          {!automation.enabled ? t(' · paused') : ''}
        </span>
      </button>
      <Switch
        checked={automation.enabled}
        aria-label={automation.enabled ? t('Disable automation') : t('Enable automation')}
        data-automation-enabled={automation.id}
        onCheckedChange={(enabled) => void setEnabled(automation, enabled)}
      />
    </div>
  )
}

function AutomationDetail({
  automation,
  runs,
  names,
  onEdit
}: {
  automation: HostedAutomation
  runs: HostedAutomationRun[]
  names: Map<string, string>
  onEdit: () => void
}) {
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const needsWorkspace = automation.trigger.kind !== 'schedule' && !automation.workspaceId
  const activeWorkspace = useStore((s) => s.activeWorkspaceId)
  const runTarget = needsWorkspace
    ? (allWorkspaces().find((w) => w.id === activeWorkspace && w.hostId === automation.hostId)?.id ?? null)
    : automation.workspaceId

  async function act(work: () => Promise<unknown>) {
    setError(null)
    try {
      await work()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-8 pt-8 pb-16" data-automation-detail={automation.id}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-lg font-semibold">{automation.name}</h2>
          <p className="text-xs text-muted-foreground">
            {triggerLabel(automation.trigger, names)}
            {automation.workspaceId ? ` · ${names.get(automation.workspaceId) ?? t('removed workspace')}` : ''} ·{' '}
            {chatAgentLabel(automation.agent)}
            {automation.effort ? ` (${automation.effort})` : ''}
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          disabled={!runTarget}
          title={runTarget ? undefined : t('Select a workspace on this host to run it in')}
          data-automation-run-now
          onClick={() =>
            void act(() =>
              harnessRequest(
                HARNESS_METHODS.automationRunNow,
                { id: automation.id, ...(runTarget ? { workspaceId: runTarget } : {}) },
                automation.hostId
              )
            )
          }
        >
          <Play />
          {t('Run now')}
        </Button>
        <Button size="sm" variant="outline" onClick={onEdit}>
          <Pencil />
          {t('Edit')}
        </Button>
        <Button size="sm" variant="ghost" aria-label={t('Delete automation')} data-automation-delete onClick={() => setConfirmDelete(true)}>
          <Trash2 />
        </Button>
      </div>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      <section className="grid gap-2">
        <h3 className="text-xs font-semibold tracking-[0.05em] text-muted-foreground uppercase">{t('Prompt')}</h3>
        <pre className="rounded-lg border border-border bg-muted/30 p-3 font-sans text-sm whitespace-pre-wrap">
          {automation.prompt}
        </pre>
      </section>
      <section className="grid gap-2">
        <h3 className="text-xs font-semibold tracking-[0.05em] text-muted-foreground uppercase">
          {t('Run history')}
          {runs.length > 0 ? ` (${runs.length})` : ''}
        </h3>
        {runs.length === 0 ? (
          <p className="text-xs text-muted-foreground">{t('No runs yet.')}</p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-border">
            <table className="w-full text-left text-xs" data-automation-runs>
              <thead className="bg-muted/40 text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">{t('Run')}</th>
                  <th className="px-3 py-2 font-medium">{t('Status')}</th>
                  <th className="px-3 py-2 font-medium">{t('Trigger')}</th>
                  <th className="px-3 py-2 font-medium">{t('Started')}</th>
                  <th className="px-3 py-2 font-medium">{t('Workspace')}</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => (
                  <RunRow key={run.id} run={run} workspace={run.workspaceId ? (names.get(run.workspaceId) ?? '—') : '—'} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('Delete “{name}”?', { name: automation.name })}</DialogTitle>
            <DialogDescription>{t('Its schedule stops and its run history goes. Chats its runs opened stay open.')}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(false)}>
              {t('Cancel')}
            </Button>
            <Button
              variant="destructive"
              data-automation-delete-confirm
              onClick={() => {
                setConfirmDelete(false)
                selectAutomation(null)
                void act(() => harnessRequest(HARNESS_METHODS.automationDelete, { id: automation.id }, automation.hostId))
              }}
            >
              {t('Delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function RunRow({ run, workspace }: { run: HostedAutomationRun; workspace: string }) {
  const sessionOpen = useStore((s) => (run.sessionId ? s.sessions.some((x) => x.id === run.sessionId) : false))
  return (
    <tr className="border-t border-border" data-automation-run={run.id}>
      <td className="px-3 py-2 tabular-nums">#{run.runNumber}</td>
      <td className="px-3 py-2">
        <span
          className={cn(
            run.status === 'failed' || run.status === 'dispatch_failed'
              ? 'text-destructive'
              : run.status === 'dispatched'
                ? 'text-foreground'
                : 'text-muted-foreground'
          )}
          title={run.error ?? undefined}
        >
          {STATUS_LABEL[run.status]}
        </span>
        {run.error ? <span className="block truncate text-[11px] text-muted-foreground">{run.error}</span> : null}
      </td>
      <td className="px-3 py-2 capitalize">{t(run.trigger)}</td>
      <td className="px-3 py-2 tabular-nums">{formatTime(run.startedAt ?? run.scheduledFor)}</td>
      <td className="max-w-[160px] truncate px-3 py-2">{workspace}</td>
      <td className="px-3 py-2 text-right">
        {run.sessionId && sessionOpen ? (
          <Button
            size="xs"
            variant="ghost"
            data-automation-open-run={run.id}
            onClick={() => {
              setAutomationsPageOpen(false)
              if (run.sessionId) selectSession(run.sessionId)
            }}
          >
            <MessageSquare />
            {t('Open chat')}
          </Button>
        ) : null}
      </td>
    </tr>
  )
}
