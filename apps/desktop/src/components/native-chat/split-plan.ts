import { t } from '@/i18n/i18n'

/** What the approval card knows about a request. */
export interface RequestFacts {
  title: string
  input?: unknown
  toolName?: string
}

/** A request from the harness's split_work tool, by the tool name the daemon sends with it. */
export function isSplitRequest(request: RequestFacts): boolean {
  return request.toolName?.endsWith('__split_work') ?? false
}

/** The number of parts a split_work request asks for, or null for any other request. */
export function splitPartCount(request: RequestFacts): number | null {
  const input = request.input
  if (!isSplitRequest(request) || typeof input !== 'object' || input === null || !('parts' in input) || !Array.isArray(input.parts)) return null
  return input.parts.length > 0 ? input.parts.length : null
}

/**
 * A split_work request, as the person should see it before approving: the goal, then each part
 * with what it does and the files it may change (its helpers then edit without asking).
 */
export function splitPlanOf(request: RequestFacts): string | null {
  if (splitPartCount(request) === null) return null
  const { goal, parts } = request.input as { goal?: unknown; parts: unknown[] }
  const lines = parts.flatMap((part: unknown) => {
    if (typeof part !== 'object' || part === null) return []
    const name = 'title' in part && typeof part.title === 'string' ? part.title : t('Untitled part')
    const task = 'task' in part && typeof part.task === 'string' ? part.task.replace(/\s+/g, ' ').trim() : ''
    const owns = 'owns' in part && Array.isArray(part.owns) ? part.owns.filter((o): o is string => typeof o === 'string') : []
    return [
      `- **${name}**${task ? `: ${task}` : ''}`,
      ...(owns.length > 0 ? [`  ${t('Files')}: ${owns.map((o) => `\`${o}\``).join(', ')}`] : [])
    ]
  })
  return [
    ...(typeof goal === 'string' && goal.trim() ? [goal.trim(), ''] : []),
    t('The parts run at once, each in a worktree of its own, and are merged into this branch when done. Their edits are not asked about one by one, and several agents at once use more of your usage limit.'),
    '',
    ...lines
  ].join('\n')
}
