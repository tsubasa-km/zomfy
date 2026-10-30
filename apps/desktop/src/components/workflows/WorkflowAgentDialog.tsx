import { useState } from 'react'
import { Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import type { WorkflowAgentProfile } from '@acp-harness/protocol'
import type { HostId } from '@/session-store'
import { removeWorkflowAgent, saveWorkflowAgent } from '@/stores/workflow-agents-store'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { WorkflowStepAgentField } from './WorkflowStepAgentField'
import { WorkflowToolsEditor } from './WorkflowToolsEditor'
import { t } from '@/i18n/i18n'

// Defines an agent once for every workflow on the host: which agent runs it, whether its model is
// local, its role, standing instructions and tools. Steps using it follow later edits.

export function blankAgentProfile(kind: WorkflowAgentProfile['kind']): WorkflowAgentProfile {
  return { id: crypto.randomUUID(), name: '', kind, role: '', prompt: '', updatedAt: 0 }
}

export function WorkflowAgentDialog({
  hostId,
  initial,
  isNew,
  usedBy,
  onClose,
  onSaved
}: {
  hostId: HostId
  initial: WorkflowAgentProfile
  isNew: boolean
  /** Steps in the open workflow that use it, for the delete warning. */
  usedBy: number
  onClose: () => void
  onSaved: (agent: WorkflowAgentProfile) => void
}) {
  const [agent, setAgent] = useState(initial)
  const [busy, setBusy] = useState(false)
  const set = (patch: Partial<WorkflowAgentProfile>) => setAgent((a) => ({ ...a, ...patch }))
  const name = agent.name.trim()

  const save = async () => {
    setBusy(true)
    try {
      const claude = (agent.agent ?? 'claude') === 'claude'
      const saved = {
        ...agent,
        name,
        role: agent.role?.trim() || undefined,
        prompt: agent.prompt?.trim() || undefined,
        // Claude runs in the cloud, and its model is the chat's.
        local: claude ? undefined : agent.local,
        model: claude ? undefined : agent.model?.trim() || undefined
      }
      await saveWorkflowAgent(hostId, saved)
      onSaved(saved)
    } catch (error) {
      toast.error(t('Could not save the agent'), { description: String(error) })
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    const note =
      usedBy > 1
        ? t(' {n} steps in this workflow use it and will need another agent.', { n: usedBy })
        : usedBy === 1
          ? t(' {n} step in this workflow use it and will need another agent.', { n: usedBy })
          : ''
    if (!window.confirm(t('Delete the agent "{name}" from every workflow on this host?', { name: initial.name }) + note)) return
    await removeWorkflowAgent(hostId, initial.id).catch((error: unknown) =>
      toast.error(t('Could not delete the agent'), { description: String(error) })
    )
    onClose()
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg" data-workflow-agent-dialog>
        <DialogHeader>
          <DialogTitle>{isNew ? t('New agent') : t('Edit “{name}”', { name: initial.name })}</DialogTitle>
          <DialogDescription>{t('Defined once on this host; every step that uses it follows your changes.')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-[1fr_auto] gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs" htmlFor="workflow-agent-name">
                {t('Name')}
              </Label>
              <Input
                id="workflow-agent-name"
                value={agent.name}
                placeholder={t('Local developer')}
                autoFocus
                onChange={(e) => set({ name: e.target.value })}
                className="h-8"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">{t('Does')}</Label>
              <Select value={agent.kind} onValueChange={(v) => set({ kind: v === 'review' ? 'review' : 'agent' })}>
                <SelectTrigger size="sm" className="h-8 w-36 text-xs" aria-label={t('Does')}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="agent">{t('The work')}</SelectItem>
                  <SelectItem value="review">{t('Reviews')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <WorkflowStepAgentField hostId={hostId} agent={agent.agent} onChange={(id) => set({ agent: id })} />
          <div className="flex items-start justify-between gap-3" data-workflow-agent-local>
            <div className="space-y-0.5">
              <div className="text-xs font-medium">{t('Runs on a local model')}</div>
              <p className="text-[11px] text-muted-foreground">
                {t('Its model runs on your own machines (for example OpenCode on the in-house LLM), so it may see data marked local only.')}
              </p>
            </div>
            <Switch
              checked={agent.local === true}
              disabled={(agent.agent ?? 'claude') === 'claude'}
              onCheckedChange={(on) => set({ local: on || undefined })}
              aria-label={t('Runs on a local model')}
            />
          </div>
          {(agent.agent ?? 'claude') !== 'claude' && (
            <div className="space-y-1.5">
              <Label className="text-xs" htmlFor="workflow-agent-model">
                {t('Model')}
              </Label>
              <Input
                id="workflow-agent-model"
                value={agent.model ?? ''}
                placeholder={agent.local ? t('Required: the local model, as the agent names it') : t('The agent’s default')}
                onChange={(e) => set({ model: e.target.value || undefined })}
                className="h-8 font-mono text-xs"
              />
              <p className="text-[11px] text-muted-foreground">
                {t(
                  'Set on each session it starts; the step fails if the agent offers no such model. A local agent needs one, so “local” is checked, not just claimed.'
                )}
              </p>
            </div>
          )}
          <div className="space-y-1.5">
            <Label className="text-xs">{t('Role')}</Label>
            <Input value={agent.role ?? ''} placeholder={name || t('Developer')} onChange={(e) => set({ role: e.target.value })} className="h-8" />
            <p className="text-[11px] text-muted-foreground">{t('Who it acts as; it opens its prompt. Empty: its name.')}</p>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">{t('Instructions')}</Label>
            <Textarea value={agent.prompt ?? ''} onChange={(e) => set({ prompt: e.target.value })} className="min-h-24 text-xs" />
            <p className="text-[11px] text-muted-foreground">{t("Given in every step it runs; a step's own instructions come after.")}</p>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">{t('Helper agents at once')}</Label>
            <Input
              type="number"
              min={0}
              max={16}
              value={agent.maxAgents ?? 0}
              onChange={(e) => {
                const next = Math.min(16, Math.max(0, Number(e.target.value) || 0))
                set({ maxAgents: next > 0 ? next : undefined })
              }}
              className="h-8 w-24"
            />
          </div>
          <WorkflowToolsEditor
            hostId={hostId}
            tools={agent.tools}
            claude={(agent.agent ?? 'claude') === 'claude'}
            onChange={(tools) => set({ tools })}
          />
        </div>
        <DialogFooter className="sm:justify-between">
          {!isNew ? (
            <Button variant="ghost" size="sm" onClick={() => void remove()}>
              <Trash2 className="size-3.5" />
              {t('Delete agent')}
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>
              {t('Cancel')}
            </Button>
            <Button onClick={() => void save()} disabled={!name || busy || (agent.local === true && !agent.model?.trim())} data-workflow-agent-save>
              {isNew ? t('Create') : t('Save')}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
