import { useState } from 'react'
import { ChevronDown, Pencil, Play, Plus, Trash2 } from 'lucide-react'
import { tuiAgentSpec, type QuickCommand } from '@acp-harness/protocol'
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList, CommandSeparator } from '@/components/ui/command'
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { TuiAgentIcon } from '@/components/terminal/TuiAgentIcon'
import { requestQuickCommandEditor } from '@/components/terminal/QuickCommandDialog'
import {
  commandsForProject,
  newQuickCommand,
  removeQuickCommand,
  runQuickCommandInNewTab,
  useQuickCommands
} from '@/lib/quick-commands'
import { cn } from '@/lib/utils'
import { LOCAL_HOST, allWorkspaces, useStore } from '@/session-store'

// Ported from Orca's TabBarQuickCommandsButton / TabBarQuickCommandsMenu / TabBarQuickCommandItem.

const SEARCH_THRESHOLD = 6
const RECENT_KEY = 'acp-harness.quick-command-recent'

function readRecent(workspaceId: string): string | null {
  try {
    return (JSON.parse(localStorage.getItem(RECENT_KEY) ?? '{}') as Record<string, string>)[workspaceId] ?? null
  } catch {
    return null
  }
}

function writeRecent(workspaceId: string, id: string): void {
  try {
    const all = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '{}') as Record<string, string>
    localStorage.setItem(RECENT_KEY, JSON.stringify({ ...all, [workspaceId]: id }))
  } catch {
    // Remembering the last command is a convenience only.
  }
}

export function commandBody(command: QuickCommand): string {
  return command.action === 'agent-prompt'
    ? `${tuiAgentSpec(command.agent)?.label ?? command.agent}: ${command.prompt}`
    : command.command
}

export function QuickCommandIcon({ command, size = 12 }: { command: QuickCommand; size?: number }) {
  return command.action === 'agent-prompt' ? (
    <span className="flex shrink-0 items-center justify-center text-muted-foreground">
      <TuiAgentIcon agent={command.agent} size={size} />
    </span>
  ) : (
    <Play className="size-3 shrink-0 text-muted-foreground" fill="currentColor" strokeWidth={0} />
  )
}

/** Runs saved commands in new tabs of this workspace; shown in the tab strip next to "+". */
export function QuickCommandsButton({ workspaceId }: { workspaceId: string }) {
  const hostId = useStore((s) => allWorkspaces(s).find((w) => w.id === workspaceId)?.hostId ?? LOCAL_HOST)
  const projectId = useStore((s) => allWorkspaces(s).find((w) => w.id === workspaceId)?.projectId ?? null)
  const { project, global } = commandsForProject(useQuickCommands(hostId), projectId)
  const all = [...project, ...global]
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [recentId, setRecentId] = useState(() => readRecent(workspaceId))
  const mostRecent = all.find((c) => c.id === recentId) ?? all[0] ?? null

  const add = () =>
    requestQuickCommandEditor({
      workspaceId,
      hostId,
      mode: 'add',
      command: newQuickCommand(projectId ? { type: 'project', projectId } : { type: 'global' })
    })
  const run = (command: QuickCommand) => {
    setOpen(false)
    setRecentId(command.id)
    writeRecent(workspaceId, command.id)
    runQuickCommandInNewTab(workspaceId, command)
  }

  if (all.length === 0) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={add}
            data-quick-commands-add
            className="my-auto ml-1 flex h-7 shrink-0 items-center gap-1 rounded-md px-1.5 text-muted-foreground hover:bg-accent/50 hover:text-foreground focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
            aria-label="Add quick command"
          >
            <Play className="size-3.5" />
            <span className="text-[12px] font-medium">Command</span>
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom" sideOffset={6}>
          Save a quick command for this {projectId ? 'project' : 'workspace'}
        </TooltipContent>
      </Tooltip>
    )
  }

  const matches = (c: QuickCommand) => {
    const q = query.trim().toLowerCase()
    return !q || c.label.toLowerCase().includes(q) || commandBody(c).toLowerCase().includes(q)
  }
  const shownProject = project.filter(matches)
  const shownGlobal = global.filter(matches)
  const innerButton =
    'flex items-center bg-transparent leading-none text-muted-foreground hover:bg-accent/50 hover:text-foreground focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none'

  const renderItem = (command: QuickCommand) => (
    <CommandItem
      key={command.id}
      value={command.id}
      onSelect={() => run(command)}
      data-quick-command={command.label}
      className="group/qc mx-1 my-0.5 cursor-pointer items-center gap-2 rounded-[7px] px-2 py-1.5 text-[12px] leading-5 data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground"
    >
      <QuickCommandIcon command={command} />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium text-foreground">{command.label}</span>
        <span className="block truncate font-mono text-[11px] text-muted-foreground">{commandBody(command)}</span>
      </span>
      <span
        role="group"
        aria-label="Quick command actions"
        className="flex shrink-0 items-center gap-0.5 transition-opacity can-hover:opacity-0 group-hover/qc:opacity-100 group-data-[selected=true]/qc:opacity-100"
      >
        <button
          type="button"
          onPointerDown={(e) => {
            e.preventDefault()
            e.stopPropagation()
          }}
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            setOpen(false)
            requestQuickCommandEditor({ workspaceId, hostId, mode: 'edit', command })
          }}
          className="cursor-pointer rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label={`Edit ${command.label}`}
        >
          <Pencil className="size-3" />
        </button>
        <button
          type="button"
          onPointerDown={(e) => {
            e.preventDefault()
            e.stopPropagation()
          }}
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            void removeQuickCommand(hostId, command.id)
          }}
          className="cursor-pointer rounded p-1 text-muted-foreground hover:bg-accent hover:text-destructive"
          aria-label={`Remove ${command.label}`}
        >
          <Trash2 className="size-3" />
        </button>
      </span>
    </CommandItem>
  )

  return (
    <div className="my-auto ml-1 flex h-7 shrink-0 items-stretch overflow-hidden rounded-md border border-border/60 text-muted-foreground">
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={() => mostRecent && run(mostRecent)}
            data-quick-commands-run
            className={cn(innerButton, 'gap-1.5 rounded-l-md rounded-r-none px-1.5')}
            aria-label={mostRecent ? `Run quick command: ${mostRecent.label}` : 'Run quick command'}
          >
            <Play className="size-3 shrink-0" fill="currentColor" strokeWidth={0} />
            <span className="max-w-[160px] truncate text-[12px] font-medium">{mostRecent?.label ?? 'Run'}</span>
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom" sideOffset={6}>
          {mostRecent?.action === 'agent-prompt'
            ? `Start ${tuiAgentSpec(mostRecent.agent)?.label ?? mostRecent.agent}: ${mostRecent.prompt}`
            : `Run: ${mostRecent ? commandBody(mostRecent) : ''}`}
        </TooltipContent>
      </Tooltip>
      <DropdownMenu
        modal={false}
        open={open}
        onOpenChange={(next) => {
          setOpen(next)
          if (!next) setQuery('')
        }}
      >
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            data-quick-commands-menu
            className={cn(innerButton, 'justify-center rounded-l-none rounded-r-md border-l border-border/60 px-1')}
            aria-label="More quick commands"
          >
            <ChevronDown className="size-3" strokeWidth={2.5} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" side="bottom" sideOffset={6} className="w-80 p-0">
          <Command shouldFilter={false} loop className="bg-transparent">
            {all.length >= SEARCH_THRESHOLD && (
              <CommandInput
                autoFocus
                placeholder="Search quick commands..."
                value={query}
                onValueChange={setQuery}
                className="h-9 py-2 text-[12px]"
                wrapperClassName="border-b border-border/50 px-2"
                iconClassName="h-3.5 w-3.5"
              />
            )}
            <CommandList className="max-h-72 py-1">
              {shownProject.length + shownGlobal.length === 0 && (
                <CommandEmpty className="py-4 text-center text-[11px]">
                  {query.trim() ? 'No commands match' : 'No commands'}
                </CommandEmpty>
              )}
              {shownProject.map(renderItem)}
              {shownProject.length > 0 && shownGlobal.length > 0 && <CommandSeparator className="my-1" />}
              {shownGlobal.map(renderItem)}
            </CommandList>
            <div className="border-t border-border/50 p-1">
              <button
                type="button"
                onClick={() => {
                  setOpen(false)
                  add()
                }}
                className="flex w-full cursor-pointer items-center gap-2 rounded-[5px] px-2 py-1.5 text-[12px] text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring focus-visible:outline-none"
              >
                <Plus className="size-3.5" />
                Command
              </button>
            </div>
          </Command>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
