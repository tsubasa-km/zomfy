import { ChevronRight, Circle, CircleCheck, CircleDot, ListChecks } from 'lucide-react'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'
import {
  diffNativeChatTaskLists,
  nativeChatTaskChangeLabel,
  nativeChatTaskLabel,
  type NativeChatTask,
  type NativeChatTaskList as TaskList
} from './native-chat-task-list'

// Ported from Orca's NativeChatTaskList (inline and composer presentations).

function statusLabel(task: NativeChatTask): string {
  if (task.status === 'completed') return 'Completed'
  return task.status === 'in_progress' ? 'In progress' : 'Pending'
}

function TaskRow({ task, label }: { task: NativeChatTask; label?: string }) {
  const Icon = task.status === 'completed' ? CircleCheck : task.status === 'in_progress' ? CircleDot : Circle
  return (
    <li className={cn('flex items-start gap-1.5', task.status === 'in_progress' && 'font-medium text-chat-foreground-strong')}>
      <Icon aria-hidden className="mt-0.5 size-3.5 shrink-0" />
      <span className="sr-only">{statusLabel(task)}: </span>
      <span className={cn('min-w-0 break-words whitespace-pre-wrap', !label && task.status === 'completed' && 'line-through')}>
        {label ?? nativeChatTaskLabel(task)}
      </span>
    </li>
  )
}

function Checklist({ list }: { list: TaskList }) {
  return list.tasks.length === 0 ? (
    <p className="text-xs">No tasks</p>
  ) : (
    <ul aria-label="Tasks" className="space-y-1 py-1">
      {list.tasks.map((task, index) => (
        <TaskRow key={`${task.content}:${index}`} task={task} />
      ))}
    </ul>
  )
}

function Progress({ list }: { list: TaskList }) {
  const completed = list.tasks.filter((task) => task.status === 'completed').length
  return (
    <span className="tabular-nums" aria-label={`${completed} of ${list.tasks.length} tasks completed`}>
      {completed}/{list.tasks.length}
    </span>
  )
}

export function NativeChatTaskList({
  list,
  previous,
  presentation = 'inline'
}: {
  list: TaskList
  previous?: TaskList | null
  presentation?: 'inline' | 'composer'
}) {
  if (presentation === 'composer') {
    return (
      <Collapsible className="rounded-md border border-border bg-muted/30">
        <CollapsibleTrigger className="group flex w-full items-center gap-1.5 rounded-md px-3 py-2 text-left text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
          <ListChecks aria-hidden className="size-4 shrink-0" />
          <span className="flex-1 font-medium">Tasks</span>
          <Progress list={list} />
          <ChevronRight aria-hidden className="size-3.5 group-data-[state=open]:rotate-90" />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="scrollbar-sleek max-h-40 overflow-y-auto px-3 pb-2 text-xs text-muted-foreground">
            <Checklist list={list} />
          </div>
        </CollapsibleContent>
      </Collapsible>
    )
  }
  const changes = previous ? diffNativeChatTaskLists(previous, list) : null
  return (
    <div className="space-y-1 py-1 text-sm text-chat-foreground-faint">
      <div className="flex items-center gap-1.5 text-xs text-chat-foreground-faint">
        <ListChecks aria-hidden className="size-4 shrink-0" />
        <span className="font-medium">Tasks</span>
        <Progress list={list} />
      </div>
      {changes ? (
        <>
          {changes.length > 0 ? (
            <ul className="space-y-1 py-1">
              {changes.map((change, index) => (
                <TaskRow key={`${change.kind}:${index}`} task={change.task} label={nativeChatTaskChangeLabel(change)} />
              ))}
            </ul>
          ) : (
            <p className="text-xs text-chat-foreground-faint">Tasks unchanged</p>
          )}
          <Collapsible>
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="group flex items-center gap-1 rounded py-0.5 text-xs text-chat-foreground-faint hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                <ChevronRight aria-hidden className="size-3.5 group-data-[state=open]:rotate-90" />
                Full task list
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <Checklist list={list} />
            </CollapsibleContent>
          </Collapsible>
        </>
      ) : (
        <Checklist list={list} />
      )}
    </div>
  )
}

/** The conversation's current task list, docked between the transcript and the composer. */
export function NativeChatDockedTaskList({ list }: { list: TaskList | null }) {
  if (!list || list.tasks.length === 0) return null
  return (
    <div className="shrink-0 px-3 pb-2 sm:px-4">
      <div className="mx-auto w-full max-w-(--chat-content-max-width)">
        <NativeChatTaskList list={list} presentation="composer" />
      </div>
    </div>
  )
}
