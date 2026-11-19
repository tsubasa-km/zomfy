import { Command, FolderGit2, FolderPlus, GitBranch, Settings, Sparkles, SquarePen } from 'lucide-react'
import { openStartTab } from '@/session-store'
import { openAddProjectDialog, openNewWorkspaceDialog } from '@/lib/project-dialogs'
import { defaultHostId } from '@/lib/default-host'
import { openSettings, setCommandPalette, setSkillsPageOpen } from '@/stores/app-overlay-store'
import { SurfaceList, type Surface } from './SurfaceList'
import { t } from '@/i18n/i18n'

// A window pane with nothing open and no workspace in front: the same list a project's empty pane
// shows, with what can start without one.

export function WindowEmptyPane() {
  const surfaces: Surface[] = [
    { id: 'thread', key: 'N', label: t('New thread'), icon: <SquarePen className="size-4" />, open: () => openStartTab() },
    { id: 'workspace', key: 'W', label: t('New workspace…'), icon: <FolderGit2 className="size-4" />, open: () => openNewWorkspaceDialog() },
    { id: 'add-project', key: 'A', label: t('Add a project'), icon: <FolderPlus className="size-4" />, open: () => openAddProjectDialog({ hostId: defaultHostId() }) },
    {
      id: 'clone',
      key: 'C',
      label: t('Clone a repository'),
      icon: <GitBranch className="size-4" />,
      open: () => openAddProjectDialog({ hostId: defaultHostId(), step: 'clone' })
    },
    { id: 'palette', key: 'K', label: t('Command Palette'), icon: <Command className="size-4" />, open: () => setCommandPalette(true) },
    { id: 'skills', key: 'S', label: t('Skills'), icon: <Sparkles className="size-4" />, open: () => setSkillsPageOpen(true) },
    { id: 'settings', key: ',', label: t('Settings'), icon: <Settings className="size-4" />, open: () => openSettings() }
  ]
  return (
    <div data-empty-pane="window" className="flex min-h-0 flex-1 flex-col">
      <SurfaceList surfaces={surfaces} />
    </div>
  )
}
