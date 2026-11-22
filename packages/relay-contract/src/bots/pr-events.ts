// Pull request events for PRs a bot's worker opened; they wake the worker whose workspace is that
// branch at that commit.

import { z } from 'zod'

export const PR_EVENTS = ['opened', 'synchronize', 'closed', 'merged', 'review', 'comment', 'check_failed', 'check_passed'] as const
/** Known events; an unknown one is kept as text so a newer Worker does not break an older daemon. */
export const prEventSchema = z.union([z.enum(PR_EVENTS), z.string().min(1).max(64)])

export const prEventFieldsSchema = z.object({
  repo: z.string().regex(/^[^/\s]+\/[^/\s]+$/),
  number: z.number().int().positive(),
  branch: z.string().min(1).max(255),
  headSha: z.string().regex(/^[0-9a-f]{7,64}$/),
  event: prEventSchema
})
