import { toast } from 'sonner'
import { allProjects, allWorkspaces, getState } from '@/session-store'
import { openWorkflows } from '@/stores/workflows-store'
import { registerKeybindingDefinitions } from '@/keybindings/keybinding-definitions'
import { registerCommandHandler } from '@/keybindings/keybinding-registry'
import { t } from '@/i18n/i18n'

/** The Workflows page of the project in front (else the first project); false when there is none. */
export function openWorkflowsHere(): boolean {
  const state = getState()
  const active = allWorkspaces(state).find((w) => w.id === state.activeWorkspaceId)
  const projects = allProjects()
  const project = projects.find((p) => p.hostId === active?.hostId && p.id === active?.projectId) ?? projects[0]
  if (!project) {
    toast(t('Add a project first'), { description: t('Workflows belong to a project.') })
    return false
  }
  openWorkflows({ hostId: project.hostId, projectId: project.id, projectName: project.displayName ?? project.name })
  return true
}

export function installWorkflowsCommands(): void {
  registerKeybindingDefinitions([
    { id: 'workflows.open', title: 'Open Workflows', group: 'Global', keywords: ['workflow', 'run', 'pipeline', 'agents'], defaultBindings: [] }
  ])
  registerCommandHandler('workflows.open', () => void openWorkflowsHere())
}
