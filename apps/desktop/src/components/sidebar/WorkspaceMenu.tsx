import { invoke } from '@tauri-apps/api/core'
import {
  AppWindow,
  Code2,
  Columns2,
  Copy,
  ExternalLink,
  FolderInput,
  FolderOpen,
  GitFork,
  Mail,
  MailOpen,
  Moon,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Settings2,
  Sparkles,
  SquareTerminal,
  Trash2,
  Unlink
} from 'lucide-react'
import {
  HARNESS_METHODS,
  WORKSPACE_STATUSES,
  type ProjectGroup,
  type Workspace,
  type WorkspacePatch,
  type WorkspaceStatusId
} from '@acp-harness/protocol'
import { cancelTurn, closeTerminal, harnessRequest, isSshHost } from '@/daemon-connection'
import { LOCAL_HOST, getState, markSeen, openInColumn, useStore, type HostId } from '@/session-store'
import { WINDOW_ROLE } from '@/lib/window-role'
import { canPopOutWorkspace, popOutWorkspace } from '@/lib/workspace-window'
import {
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger
} from '@/components/ui/dropdown-menu'
import { WorkspaceStatusIcon } from './WorkspaceStatusIcon'
import { t } from '@/i18n/i18n'

// Items and order follow Orca's WorktreeContextMenuView: Update, status, Open in, Copy Path,
// Copy Worktree Name, Pin, Mark Read/Unread, Sleep, Delete.

/** `shell` is one of the local daemon's shell ids, for a terminal; none is the terminal app's default. */
export function openWorkspaceIn(target: 'vscode' | 'explorer' | 'terminal', hostId: HostId, path: string, shell?: string): void {
  void invoke('open_workspace_in', { target, host: hostId, path, shell: shell ?? null }).catch((e: unknown) => window.alert(String(e)))
}

/**
 * Opening the folder in an outside terminal. On this machine, with more than one shell, hovering it lists
 * them (open_in.rs runs the pick in Windows Terminal); WSL and SSH terminals run the host's login shell.
 */
export function OpenTerminalItem({ hostId, path, label, icon = true }: { hostId: HostId; path: string; label: string; icon?: boolean }) {
  const shells = useStore((s) => s.hosts[hostId]?.shells) ?? []
  const glyph = icon ? <SquareTerminal className="size-3.5" /> : null
  if (hostId !== LOCAL_HOST || shells.length < 2) {
    return (
      <DropdownMenuItem onSelect={() => openWorkspaceIn('terminal', hostId, path)}>
        {glyph}
        {label}
      </DropdownMenuItem>
    )
  }
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger data-open-terminal>
        {glyph}
        {label}
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent>
        <DropdownMenuItem data-open-terminal-shell="default" onSelect={() => openWorkspaceIn('terminal', hostId, path)}>
          {t('Windows Terminal default')}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {shells.map((shell) => (
          <DropdownMenuItem key={shell.id} data-open-terminal-shell={shell.id} onSelect={() => openWorkspaceIn('terminal', hostId, path, shell.id)}>
            {t(shell.label)}
          </DropdownMenuItem>
        ))}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  )
}

export function OpenInSubmenu({ hostId, path }: { hostId: HostId; path: string }) {
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <ExternalLink className="size-3.5" />
        {t('Open in')}
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent>
        <DropdownMenuItem onSelect={() => openWorkspaceIn('vscode', hostId, path)}>
          <Code2 className="size-3.5" />
          VS Code
        </DropdownMenuItem>
        {/* No local file manager can show an SSH host's folders; VS Code Remote-SSH can. */}
        {!isSshHost(hostId) && (
          <DropdownMenuItem onSelect={() => openWorkspaceIn('explorer', hostId, path)}>
            <FolderOpen className="size-3.5" />
            {t('File Explorer')}
          </DropdownMenuItem>
        )}
        <OpenTerminalItem hostId={hostId} path={path} label={t('Terminal')} />
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  )
}

export function updateWorkspace(workspaceId: string, patch: WorkspacePatch): Promise<unknown> {
  return harnessRequest(HARNESS_METHODS.workspaceUpdate, { workspaceId, patch }).catch((e: unknown) =>
    window.alert(e instanceof Error ? e.message : String(e))
  )
}

const update = (workspaceId: string, patch: WorkspacePatch) => void updateWorkspace(workspaceId, patch)

/** Mark Read also clears the window's per-session unread marks. */
export function markWorkspaceRead(workspaceId: string, read: boolean): void {
  update(workspaceId, { unread: !read })
  if (read) for (const s of getState().sessions) if (s.workspaceId === workspaceId) markSeen(s.id)
}

/** Stops what runs in a workspace (agent turns, shells) without deleting anything, like Orca's sleep. */
export function sleepWorkspace(workspaceId: string): void {
  const state = getState()
  for (const s of state.sessions) if (s.workspaceId === workspaceId && s.status !== 'idle') cancelTurn(s.id)
  for (const t of state.terminals) if (t.workspaceId === workspaceId) closeTerminal(t.id)
}

export function WorkspaceMenuItems({
  workspace,
  hostId,
  unread,
  onUpdate,
  onDelete,
  onNewChild
}: {
  workspace: Workspace
  hostId: HostId
  unread: boolean
  onUpdate: () => void
  onDelete: () => void
  onNewChild?: () => void
}) {
  return (
    <>
      <DropdownMenuLabel className="px-2 py-1 text-[11px] font-medium text-muted-foreground">{t('Workspace')}</DropdownMenuLabel>
      <DropdownMenuItem data-workspace-action="update" onSelect={onUpdate}>
        <Pencil className="size-3.5" />
        {t('Update')}
      </DropdownMenuItem>
      {WINDOW_ROLE === 'main' && (
        <>
          <DropdownMenuItem data-workspace-action="open-column" onSelect={() => openInColumn(workspace.id)}>
            <Columns2 className="size-3.5" />
            {t('Open in New Column')}
          </DropdownMenuItem>
          {canPopOutWorkspace() && (
            <DropdownMenuItem data-workspace-action="open-window" onSelect={() => void popOutWorkspace(workspace.id)}>
              <AppWindow className="size-3.5" />
              {t('Open in New Window')}
            </DropdownMenuItem>
          )}
        </>
      )}
      <DropdownMenuSub>
        <DropdownMenuSubTrigger data-workspace-action="status">
          <WorkspaceStatusIcon status={workspace.status} />
          {t('Status')}
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent>
          {WORKSPACE_STATUSES.map((s) => (
            <DropdownMenuItem
              key={s.id}
              data-workspace-status={s.id}
              onSelect={() => update(workspace.id, { status: s.id as WorkspaceStatusId })}
            >
              <WorkspaceStatusIcon status={s.id} />
              {t(s.label)}
              {workspace.status === s.id && <span className="ml-auto text-xs text-muted-foreground">✓</span>}
            </DropdownMenuItem>
          ))}
          {workspace.status && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => update(workspace.id, { status: null })}>{t('Clear status')}</DropdownMenuItem>
            </>
          )}
        </DropdownMenuSubContent>
      </DropdownMenuSub>
      {onNewChild && (
        <DropdownMenuItem data-workspace-action="new-child" onSelect={onNewChild}>
          <GitFork className="size-3.5" />
          {t('New Child Workspace…')}
        </DropdownMenuItem>
      )}
      {workspace.parentWorkspaceId && (
        <DropdownMenuItem
          data-workspace-action="detach"
          onSelect={() => update(workspace.id, { parentWorkspaceId: null })}
        >
          <Unlink className="size-3.5" />
          {t('Detach from Parent')}
        </DropdownMenuItem>
      )}
      <DropdownMenuSeparator />
      <OpenInSubmenu hostId={hostId} path={workspace.path} />
      <DropdownMenuItem onSelect={() => void navigator.clipboard.writeText(workspace.path)}>
        <Copy className="size-3.5" />
        {t('Copy Path')}
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={() => void navigator.clipboard.writeText(workspace.branch ?? workspace.name)}>
        <Copy className="size-3.5" />
        {t('Copy Worktree Name')}
      </DropdownMenuItem>
      <DropdownMenuItem data-workspace-action="pin" onSelect={() => update(workspace.id, { pinned: !workspace.pinned })}>
        {workspace.pinned ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />}
        {workspace.pinned ? t('Unpin') : t('Pin')}
      </DropdownMenuItem>
      <DropdownMenuItem
        data-workspace-action="read"
        onSelect={() => markWorkspaceRead(workspace.id, unread)}
      >
        {unread ? <MailOpen className="size-3.5" /> : <Mail className="size-3.5" />}
        {unread ? t('Mark Read') : t('Mark Unread')}
      </DropdownMenuItem>
      <DropdownMenuItem data-workspace-action="sleep" onSelect={() => sleepWorkspace(workspace.id)}>
        <Moon className="size-3.5" />
        {t('Sleep')}
      </DropdownMenuItem>
      {!workspace.isPrimary && (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuItem data-workspace-action="delete" variant="destructive" onSelect={onDelete}>
            <Trash2 className="size-3.5" />
            {workspace.branch ? t('Delete Worktree') : t('Remove Workspace')}
          </DropdownMenuItem>
        </>
      )}
    </>
  )
}

export function ProjectMenuItems({
  hostId,
  path,
  groups,
  groupId,
  onNewWorkspace,
  onSettings,
  onMoveToGroup,
  onNewGroup,
  onCleanUp,
  onRemove
}: {
  hostId: HostId
  path: string
  groups: ProjectGroup[]
  groupId?: string
  onNewWorkspace: () => void
  onSettings: () => void
  onMoveToGroup: (groupId: string | null) => void
  onNewGroup: () => void
  onCleanUp?: () => void
  onRemove: () => void
}) {
  return (
    <>
      <DropdownMenuItem onSelect={onNewWorkspace}>
        <Plus className="size-3.5" />
        {t('New Workspace…')}
      </DropdownMenuItem>
      <DropdownMenuItem data-project-action="settings" onSelect={onSettings}>
        <Settings2 className="size-3.5" />
        {t('Project Settings…')}
      </DropdownMenuItem>
      <DropdownMenuSub>
        <DropdownMenuSubTrigger data-project-action="move-to-group">
          <FolderInput className="size-3.5" />
          {t('Move to Group')}
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent>
          {groups.map((g) => (
            <DropdownMenuItem key={g.id} data-group-target={g.id} onSelect={() => onMoveToGroup(g.id)}>
              {g.name}
              {g.id === groupId && <span className="ml-auto text-xs text-muted-foreground">✓</span>}
            </DropdownMenuItem>
          ))}
          {groups.length > 0 && <DropdownMenuSeparator />}
          <DropdownMenuItem data-project-action="new-group" onSelect={onNewGroup}>
            <Plus className="size-3.5" />
            {t('New Group…')}
          </DropdownMenuItem>
          {groupId && (
            <DropdownMenuItem onSelect={() => onMoveToGroup(null)}>{t('Remove from Group')}</DropdownMenuItem>
          )}
        </DropdownMenuSubContent>
      </DropdownMenuSub>
      {onCleanUp && (
        <DropdownMenuItem data-project-action="cleanup" onSelect={onCleanUp}>
          <Sparkles className="size-3.5" />
          {t('Clean Up Merged Workspaces…')}
        </DropdownMenuItem>
      )}
      <DropdownMenuSeparator />
      <OpenInSubmenu hostId={hostId} path={path} />
      <DropdownMenuItem onSelect={() => void navigator.clipboard.writeText(path)}>
        <Copy className="size-3.5" />
        {t('Copy Path')}
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem data-project-action="remove" variant="destructive" onSelect={onRemove}>
        <Trash2 className="size-3.5" />
        {t('Remove Project')}
      </DropdownMenuItem>
    </>
  )
}
