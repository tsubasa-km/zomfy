import { describe, expect, test } from 'bun:test'
import { workflowScorecard, type WorkflowRun, type WorkflowRunStep } from '@acp-harness/protocol'

// A run's scorecard: tokens summed over steps, files re-read after a handoff (unless changed in
// between), commands re-run by a later step, and rounds.

function step(nodeId: string, extra: Partial<WorkflowRunStep>): WorkflowRunStep {
  return { id: nodeId, nodeId, label: nodeId, startedAt: 0, endedAt: 10, outcome: 'next', summary: 'done', sessionIds: ['s'], ...extra }
}

function run(steps: WorkflowRunStep[]): WorkflowRun {
  return {
    id: 'r',
    workflowId: 'w',
    projectId: 'p',
    workflow: { id: 'w', projectId: 'p', name: 'w', nodes: [], edges: [], updatedAt: 0 },
    task: 't',
    status: 'done',
    currentNodeId: null,
    workspaceId: 'ws',
    rounds: {},
    sessionsByNode: {},
    steps,
    createdAt: 0,
    endedAt: 100
  }
}

describe('workflowScorecard', () => {
  test('counts what a later step read or ran again, but not a file changed in between', () => {
    const card = workflowScorecard(
      run([
        step('dev', {
          usage: { inputTokens: 100, outputTokens: 10, cacheReadTokens: 50, costUsd: 0.5 },
          reads: ['src/a.ts', 'src/b.ts', 'src/a.ts'],
          edits: ['src/b.ts'],
          commands: ['bun test']
        }),
        step('review', {
          outcome: 'changes',
          usage: { inputTokens: 200, outputTokens: 20, cacheReadTokens: 0 },
          reads: ['src\\a.ts', 'src/c.ts'],
          commands: ['bun  test', 'git diff']
        }),
        step('dev', { reads: ['src/b.ts'], sessionIds: ['s2'] })
      ])
    )
    expect(card.usage).toEqual({ inputTokens: 300, outputTokens: 30, cacheReadTokens: 50, costUsd: 0.5 })
    expect(card.unmetered).toBe(1)
    expect([card.reads, card.repeatedReads, card.rereadAfterHandoff]).toEqual([6, 1, 1])
    expect([card.commands, card.rerunCommands]).toEqual([3, 1])
    expect(card.sentBack).toBe(1)
    expect(card.durationMs).toBe(100)
  })
})
