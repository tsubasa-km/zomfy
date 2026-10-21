import { useEffect, useState, useSyncExternalStore } from 'react'
import { TUI_AGENTS, supportsAgentPromptQuickCommand, type QuickCommand, type TuiAgentId } from '@acp-harness/protocol'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { TuiAgentIcon } from '@/components/terminal/TuiAgentIcon'
import { saveQuickCommand } from '@/lib/quick-commands'
import { SUBMIT_SHORTCUT_LABEL, isSubmitShortcut } from '@/lib/terminal-shortcuts'
import { cn } from '@/lib/utils'
import { allWorkspaces, useStore, type HostId } from '@/session-store'

// Ported from Orca's TerminalQuickCommandDialog and its field components.

const TOGGLE_ITEM_CLASS =
  'data-[state=on]:border-foreground/20 data-[state=on]:bg-foreground/10 data-[state=on]:text-foreground data-[state=on]:shadow-xs data-[state=on]:hover:bg-foreground/15 data-[state=on]:hover:text-foreground'

const PROMPT_AGENTS = TUI_AGENTS.filter((agent) => supportsAgentPromptQuickCommand(agent.id))

interface EditorRequest {
  workspaceId: string
  hostId: HostId
  mode: 'add' | 'edit'
  command: QuickCommand
}

// The menus that open the editor unmount on select, so the request goes through a tiny store.
let request: EditorRequest | null = null
const listeners = new Set<() => void>()

export function requestQuickCommandEditor(next: EditorRequest | null): void {
  request = next
  for (const listener of listeners) listener()
}

interface Draft {
  label: string
  action: QuickCommand['action']
  command: string
  appendEnter: boolean
  agent: TuiAgentId
  prompt: string
  scope: QuickCommand['scope']
}

function toDraft(command: QuickCommand): Draft {
  return {
    label: command.label,
    action: command.action,
    command: command.action === 'terminal-command' ? command.command : '',
    appendEnter: command.action === 'terminal-command' ? command.appendEnter : true,
    agent: command.action === 'agent-prompt' ? command.agent : (PROMPT_AGENTS[0]?.id ?? 'claude'),
    prompt: command.action === 'agent-prompt' ? command.prompt : '',
    scope: command.scope
  }
}

export function QuickCommandDialog({ workspaceId }: { workspaceId: string }) {
  const current = useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => request
  )
  const open = current?.workspaceId === workspaceId ? current : null
  const projectId = useStore((s) => allWorkspaces(s).find((w) => w.id === workspaceId)?.projectId ?? null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setDraft(open ? toDraft(open.command) : null)
  }, [open])

  if (!open || !draft) return null
  const isAgent = draft.action === 'agent-prompt'
  const body = isAgent ? draft.prompt : draft.command
  const canSave = !saving && draft.label.trim().length > 0 && body.trim().length > 0
  const update = (change: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...change } : d))

  const save = async () => {
    if (!canSave) return
    const base = { id: open.command.id, label: draft.label.trim(), scope: draft.scope }
    const next: QuickCommand = isAgent
      ? { ...base, action: 'agent-prompt', agent: draft.agent, prompt: draft.prompt.trimEnd() }
      : { ...base, action: 'terminal-command', command: draft.command.trimEnd(), appendEnter: draft.appendEnter }
    setSaving(true)
    try {
      await saveQuickCommand(open.hostId, next)
      requestQuickCommandEditor(null)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={(next) => !next && !saving && requestQuickCommandEditor(null)}>
      <DialogContent
        className="flex max-h-[min(90vh,52rem)] w-full max-w-3xl flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl"
        showCloseButton={false}
      >
        <DialogHeader className="px-6 pt-6 pb-0">
          <DialogTitle className="text-sm">{open.mode === 'edit' ? 'Edit Quick Command' : 'Add Quick Command'}</DialogTitle>
          <DialogDescription className="text-xs">Saved items appear in the tab bar menu for one-click run.</DialogDescription>
        </DialogHeader>

        <fieldset
          disabled={saving}
          className="scrollbar-sleek flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-y-auto px-6 py-5"
          onKeyDown={(e) => {
            if (isSubmitShortcut(e)) {
              e.preventDefault()
              void save()
            }
          }}
        >
          <div className="grid grid-cols-1 items-end gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
            <div className="space-y-2">
              <Label htmlFor="quick-command-label">Label</Label>
              <Input
                id="quick-command-label"
                autoFocus
                value={draft.label}
                onChange={(e) => update({ label: e.target.value })}
                placeholder="Start dev server"
              />
            </div>
            <div className="space-y-2">
              <Label>Action</Label>
              <ToggleGroup
                type="single"
                variant="outline"
                value={draft.action}
                onValueChange={(value) => {
                  if (value === 'terminal-command' || value === 'agent-prompt') update({ action: value })
                }}
                className="grid w-[11.5rem] grid-cols-2"
              >
                <ToggleGroupItem value="terminal-command" aria-label="Terminal Command" className={cn(TOGGLE_ITEM_CLASS, 'w-full justify-center')}>
                  Terminal
                </ToggleGroupItem>
                <ToggleGroupItem value="agent-prompt" aria-label="Agent Prompt" className={cn(TOGGLE_ITEM_CLASS, 'w-full justify-center')}>
                  Agent
                </ToggleGroupItem>
              </ToggleGroup>
            </div>
          </div>

          {isAgent && (
            <div className="space-y-2">
              <Label>Agent</Label>
              <Select value={draft.agent} onValueChange={(value) => update({ agent: value as TuiAgentId })}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Choose agent" />
                </SelectTrigger>
                <SelectContent position="popper" align="start" className="max-h-[min(20rem,var(--radix-select-content-available-height))]">
                  {PROMPT_AGENTS.map((agent) => (
                    <SelectItem key={agent.id} value={agent.id}>
                      <TuiAgentIcon agent={agent.id} size={16} />
                      {agent.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* The textarea drops its own ring, so the frame carries the focus state. */}
          <div className="overflow-hidden rounded-md border border-border bg-[var(--editor-surface)] transition-[color,box-shadow] focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50">
            <div className="flex items-center justify-between gap-3 border-b border-border bg-muted/70 px-3 py-2">
              <span className="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
                {isAgent ? 'Prompt' : 'Command'}
              </span>
            </div>
            <textarea
              value={body}
              aria-label={isAgent ? 'Prompt' : 'Command'}
              onChange={(e) => update(isAgent ? { prompt: e.target.value } : { command: e.target.value })}
              placeholder={isAgent ? 'Ask the agent to investigate this workspace' : 'npm run dev'}
              spellCheck={isAgent}
              rows={10}
              className={cn(
                'min-h-[14rem] w-full resize-y border-0 bg-transparent px-3.5 py-3 text-sm outline-none focus-visible:ring-0',
                !isAgent && 'font-mono text-[13px]'
              )}
            />
            <div className="flex items-center justify-between gap-3 border-t border-border bg-muted/50 px-3 py-2">
              {isAgent ? (
                <span className="text-[11px] text-muted-foreground">Multi-line prompts are fine — keep them focused.</span>
              ) : (
                <label className="flex min-w-0 cursor-pointer items-center gap-2">
                  <Switch
                    checked={draft.appendEnter}
                    aria-label="Toggle append Enter"
                    onCheckedChange={(checked) => update({ appendEnter: checked })}
                  />
                  <span className="truncate text-[11px] text-muted-foreground">Append Enter — run immediately</span>
                </label>
              )}
              <span className="shrink-0 text-[11px] text-muted-foreground">Drag corner to resize</span>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Scope</Label>
            <ToggleGroup
              type="single"
              variant="outline"
              value={draft.scope.type}
              onValueChange={(value) => {
                if (value === 'global') update({ scope: { type: 'global' } })
                if (value === 'project' && projectId) update({ scope: { type: 'project', projectId } })
              }}
              className="justify-start"
            >
              <ToggleGroupItem value="global" className={TOGGLE_ITEM_CLASS}>
                Global
              </ToggleGroupItem>
              <ToggleGroupItem value="project" disabled={!projectId} className={TOGGLE_ITEM_CLASS}>
                Project
              </ToggleGroupItem>
            </ToggleGroup>
          </div>
        </fieldset>

        <DialogFooter className="border-t border-border px-6 py-4 sm:justify-end">
          <Button type="button" variant="outline" disabled={saving} onClick={() => requestQuickCommandEditor(null)}>
            Cancel
          </Button>
          <Button type="button" disabled={!canSave} onClick={() => void save()} title={`Save (${SUBMIT_SHORTCUT_LABEL})`}>
            Save
            <span className="ml-1 text-[10px] opacity-60">{SUBMIT_SHORTCUT_LABEL}</span>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
