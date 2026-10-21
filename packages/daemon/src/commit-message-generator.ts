import { query } from '@anthropic-ai/claude-agent-sdk'
import { git } from './git-cli.ts'
import { log } from './log.ts'
import { resolveClaudeExecutable } from './claude-executable.ts'

// Orca's sparkle button (shared/commit-message-generation.ts): one tool-less Claude turn over the
// staged diff, through the user's own claude CLI so their login applies (as in claude-turn.ts).

const STAGED_DIFF_BUDGET = 200_000
const running = new Map<string, AbortController>()

export async function generateCommitMessage(workspaceId: string, cwd: string): Promise<string> {
  running.get(workspaceId)?.abort()
  const abort = new AbortController()
  running.set(workspaceId, abort)
  try {
    const [branch, summary, patch] = await Promise.all([
      git(cwd, ['symbolic-ref', '--quiet', '--short', 'HEAD'], { quiet: true }).catch(() => ''),
      git(cwd, ['diff', '--cached', '--name-status']),
      git(cwd, ['diff', '--cached', '--patch', '--minimal', '--no-color', '--no-ext-diff']).catch(() => '')
    ])
    if (!summary.trim()) throw new Error('Stage at least one file to generate a message.')
    const stream = query({
      prompt: buildCommitMessagePrompt(branch || null, summary, patch),
      options: {
        cwd,
        pathToClaudeCodeExecutable: await resolveClaudeExecutable(),
        tools: [],
        maxTurns: 1,
        persistSession: false,
        settingSources: [],
        abortController: abort,
        stderr: (line) => log(`[commit-message] ${line}`)
      }
    })
    let result = ''
    for await (const message of stream) {
      if (message.type === 'result') {
        if (message.subtype !== 'success') throw new Error(`Claude could not generate a message (${message.subtype}).`)
        result = message.result
      }
    }
    if (abort.signal.aborted) throw new Error('Commit message generation was cancelled.')
    const cleaned = cleanGeneratedMessage(result)
    if (!cleaned) throw new Error('Claude returned an empty commit message.')
    return cleaned
  } catch (error) {
    if (abort.signal.aborted) throw new Error('Commit message generation was cancelled.')
    throw error
  } finally {
    if (running.get(workspaceId) === abort) running.delete(workspaceId)
  }
}

export function cancelCommitMessage(workspaceId: string): void {
  running.get(workspaceId)?.abort()
}

function buildCommitMessagePrompt(branch: string | null, stagedSummary: string, stagedPatch: string): string {
  const patch = stagedPatch.trim()
    ? truncate(stagedPatch, STAGED_DIFF_BUDGET)
    : '(diff omitted — too large to read; infer the change from the staged file list above)'
  return [
    'You are generating a single git commit message.',
    'Return only the commit message text. Do not include a preamble, quotes, or code fences.',
    '',
    'Rules:',
    '- First line: imperative mood, <= 72 chars, no trailing period.',
    '- Optional body: blank line, then short wrapped bullet points or prose explaining WHY.',
    '- Capture the primary user-visible or developer-visible change.',
    '- Use only the staged changes below as context.',
    '- Do not include "Co-authored-by" or other git trailers.',
    '',
    `Branch: ${branch ?? '(detached)'}`,
    '',
    'Staged files:',
    truncate(stagedSummary, 6_000),
    '',
    'Staged patch:',
    '```diff',
    patch,
    '```'
  ].join('\n')
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max)}\n\n[truncated: ${value.length - max} characters omitted]`
}

/** Strips fences, wrapping quotes and trailers, and caps the subject like Orca's splitGeneratedCommitMessage. */
function cleanGeneratedMessage(raw: string): string {
  let text = raw.trim().replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/, '').trim()
  if (/^(["'`]).*\1$/s.test(text)) text = text.slice(1, -1).trim()
  text = text
    .split('\n')
    .filter((line) => !/^(co-authored-by|signed-off-by):/i.test(line.trim()))
    .join('\n')
    .trim()
  const newline = text.indexOf('\n')
  const subject = (newline === -1 ? text : text.slice(0, newline)).trim().replace(/[.]+$/, '').slice(0, 72).trimEnd()
  const body = newline === -1 ? '' : text.slice(newline + 1).trim()
  return body ? `${subject}\n\n${body}` : subject
}
