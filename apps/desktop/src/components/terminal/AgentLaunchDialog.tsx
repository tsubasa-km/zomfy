import { useEffect, useState, useSyncExternalStore } from 'react'
import { tuiAgentSpec, type TuiAgentId } from '@acp-harness/protocol'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { TuiAgentIcon } from '@/components/terminal/TuiAgentIcon'
import { launchAgentTerminal } from '@/lib/agent-terminal-launch'
import { useDetectedAgents } from '@/lib/detected-agents'
import { SUBMIT_SHORTCUT_LABEL, isSubmitShortcut } from '@/lib/terminal-shortcuts'
import { LOCAL_HOST, allWorkspaces, useStore } from '@/session-store'

// The menu that opens this unmounts on select, so the request goes through a tiny store.
let requested: string | null = null
const listeners = new Set<() => void>()

export function requestAgentLaunchDialog(workspaceId: string | null): void {
  requested = workspaceId
  for (const listener of listeners) listener()
}

/** Picks a detected agent and its first prompt, then starts it in a new terminal tab. */
export function AgentLaunchDialog({ workspaceId }: { workspaceId: string }) {
  const open =
    useSyncExternalStore(
      (listener) => {
        listeners.add(listener)
        return () => listeners.delete(listener)
      },
      () => requested
    ) === workspaceId
  const hostId = useStore((s) => allWorkspaces(s).find((w) => w.id === workspaceId)?.hostId ?? LOCAL_HOST)
  const detected = useDetectedAgents(hostId)
  const agents = detected.kind === 'ready' ? detected.agents : []
  const [agent, setAgent] = useState<TuiAgentId | ''>('')
  const [prompt, setPrompt] = useState('')

  useEffect(() => {
    if (open) setPrompt('')
  }, [open])
  const selected: TuiAgentId | '' = agent && agents.includes(agent) ? agent : (agents.at(0) ?? '')
  const canLaunch = selected !== '' && prompt.trim().length > 0

  const launch = () => {
    if (!canLaunch) return
    requestAgentLaunchDialog(null)
    void launchAgentTerminal(workspaceId, selected, prompt)
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && requestAgentLaunchDialog(null)}>
      <DialogContent className="max-w-xl" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle className="text-sm">Launch Agent</DialogTitle>
          <DialogDescription className="text-xs">
            Starts the agent in a new terminal tab with this as its first prompt.
          </DialogDescription>
        </DialogHeader>
        <div
          className="space-y-3"
          onKeyDown={(e) => {
            if (isSubmitShortcut(e)) {
              e.preventDefault()
              launch()
            }
          }}
        >
          <div className="space-y-2">
            <Label>Agent</Label>
            <Select value={selected} onValueChange={(value) => setAgent(value as TuiAgentId)}>
              <SelectTrigger className="w-full" data-agent-select>
                <SelectValue placeholder="Choose agent" />
              </SelectTrigger>
              <SelectContent position="popper" align="start">
                {agents.map((id) => (
                  <SelectItem key={id} value={id}>
                    <TuiAgentIcon agent={id} size={14} />
                    {tuiAgentSpec(id)?.label ?? id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="agent-launch-prompt">Prompt</Label>
            <Textarea
              id="agent-launch-prompt"
              autoFocus
              rows={6}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Ask the agent to investigate this workspace"
            />
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => requestAgentLaunchDialog(null)}>
            Cancel
          </Button>
          <Button type="button" disabled={!canLaunch} onClick={launch} data-agent-launch-submit>
            Launch
            <span className="ml-1 text-[10px] opacity-60">{SUBMIT_SHORTCUT_LABEL}</span>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
