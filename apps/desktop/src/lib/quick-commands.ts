import { useEffect, useSyncExternalStore } from 'react'
import { HARNESS_METHODS, type QuickCommand, type QuickCommandScope } from '@acp-harness/protocol'
import { createTerminal, harnessRequest } from '@/daemon-connection'
import type { HostId } from '@/session-store'

// Saved commands per daemon host, as Orca keeps quick commands with the host that runs them.

const byHost = new Map<HostId, QuickCommand[]>()
const listeners = new Set<() => void>()
const EMPTY: QuickCommand[] = []

function set(hostId: HostId, list: QuickCommand[]): void {
  byHost.set(hostId, list)
  for (const listener of listeners) listener()
}

export function loadQuickCommands(hostId: HostId): Promise<void> {
  return harnessRequest(HARNESS_METHODS.quickCommandsList, {}, hostId).then(
    (list) => set(hostId, list),
    () => undefined
  )
}

export function useQuickCommands(hostId: HostId): QuickCommand[] {
  const list = useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => byHost.get(hostId) ?? EMPTY
  )
  useEffect(() => {
    void loadQuickCommands(hostId)
  }, [hostId])
  return list
}

export async function saveQuickCommand(hostId: HostId, command: QuickCommand): Promise<void> {
  set(hostId, await harnessRequest(HARNESS_METHODS.quickCommandSave, { command }, hostId))
}

export async function removeQuickCommand(hostId: HostId, id: string): Promise<void> {
  set(hostId, await harnessRequest(HARNESS_METHODS.quickCommandRemove, { id }, hostId))
}

/** Project commands first, then global ones; commands of other projects are hidden. */
export function commandsForProject(list: QuickCommand[], projectId: string | null) {
  return {
    project: list.filter((c) => c.scope.type === 'project' && c.scope.projectId === projectId),
    global: list.filter((c) => c.scope.type === 'global')
  }
}

export function newQuickCommand(scope: QuickCommandScope): QuickCommand {
  return { id: `quick-command-${crypto.randomUUID()}`, label: '', action: 'terminal-command', command: '', appendEnter: true, scope }
}

/** What a terminal command types: one line, so later lines never become a running program's stdin. */
export function quickCommandInput(command: Extract<QuickCommand, { action: 'terminal-command' }>): string {
  const line = command.command
    .split(/\r\n|\r|\n/)
    .map((part) => part.trim())
    .filter(Boolean)
    .join('; ')
  return command.appendEnter ? `${line}\r` : line
}

/** Context menu: terminal commands go to this terminal; agent prompts start their agent in a new tab. */
export function runQuickCommandInTerminal(terminalId: string, workspaceId: string, command: QuickCommand): void {
  if (command.action === 'agent-prompt') {
    void createTerminal(workspaceId, undefined, { agent: command.agent, prompt: command.prompt })
    return
  }
  void harnessRequest(HARNESS_METHODS.terminalInput, { terminalId, data: quickCommandInput(command) })
}

/** Tab-strip button: every command gets a fresh tab, as Orca's runQuickCommandInNewTab. */
export function runQuickCommandInNewTab(workspaceId: string, command: QuickCommand): void {
  void createTerminal(
    workspaceId,
    undefined,
    command.action === 'agent-prompt' ? { agent: command.agent, prompt: command.prompt } : { command: quickCommandInput(command) }
  )
}
