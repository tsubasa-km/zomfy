import { describe, expect, test } from 'bun:test'
import { applyWorkflowChange, withoutContextItem, workflowScorecard, type WorkflowRun, type WorkflowRunStep } from '@acp-harness/protocol'

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

describe('applyWorkflowChange', () => {
  const base: WorkflowRun['workflow'] = {
    id: 'w',
    projectId: 'p',
    name: 'w',
    nodes: [{ id: 'review', kind: 'review', label: 'Reviewer', x: 0, y: 0, config: { prompt: 'old', maxRounds: 3 } }],
    edges: [{ id: 'e', from: 'review', to: 'dev', outcome: 'changes' }],
    updatedAt: 0
  }

  test('rewrites instructions, clears a limit, and marks an arrow to continue the chat', () => {
    let w = applyWorkflowChange(base, { type: 'prompt', nodeId: 'review', prompt: 'new' })
    w = applyWorkflowChange(w, { type: 'maxRounds', nodeId: 'review', maxRounds: null })
    w = applyWorkflowChange(w, { type: 'continue', edgeId: 'e', on: true })
    expect(w.nodes[0]!.config).toEqual({ prompt: 'new' })
    expect(w.edges[0]!.session).toBe('continue')
    expect(applyWorkflowChange(w, { type: 'continue', edgeId: 'e', on: false }).edges[0]).toEqual({ id: 'e', from: 'review', to: 'dev', outcome: 'changes' })
    expect(base.nodes[0]!.config.prompt).toBe('old')
  })
})

describe('context ledger', () => {
  test('keeps each item once with its largest size, and counts calls that used it', () => {
    const context = (items: { kind: 'skill' | 'mcp' | 'memory' | 'agent'; name: string; tokens: number }[]) => ({ categories: [], items, totalTokens: 0, maxTokens: 0 })
    const card = workflowScorecard(
      run([
        step('dev', {
          context: context([
            { kind: 'skill', name: 'pdf', tokens: 40 },
            { kind: 'mcp', name: 'playwright', tokens: 9000 },
            { kind: 'memory', name: 'C:/repo/CLAUDE.md', tokens: 1200 }
          ]),
          skillsUsed: ['pdf']
        }),
        step('review', {
          context: context([
            { kind: 'skill', name: 'pdf', tokens: 45 },
            { kind: 'mcp', name: 'playwright', tokens: 9000 }
          ])
        })
      ])
    )
    expect(card.context.map((r) => [r.kind, r.name, r.tokens, r.loadedIn, r.used])).toEqual([
      ['mcp', 'playwright', 9000, 2, 0],
      ['memory', 'C:/repo/CLAUDE.md', 1200, 1, null],
      ['skill', 'pdf', 45, 2, 1]
    ])
  })
})

describe('withoutContextItem', () => {
  const w: WorkflowRun['workflow'] = {
    id: 'w',
    projectId: 'p',
    name: 'w',
    nodes: [
      { id: 'dev', kind: 'agent', label: 'Developer', x: 0, y: 0, config: {} },
      { id: 'review', kind: 'review', label: 'Reviewer', x: 0, y: 0, config: { tools: { skills: ['pdf', 'docx'] } } },
      { id: 'tests', kind: 'check', label: 'Tests', x: 0, y: 0, config: { command: 'bun test' } }
    ],
    edges: [],
    updatedAt: 0
  }

  test("takes a skill off each step's list, using the recorded list where a step has none", () => {
    const out = withoutContextItem(w, { kind: 'skill', name: 'pdf', keep: { dev: ['pdf', 'xlsx'] } })
    expect(out.nodes.map((n) => n.config.tools?.skills)).toEqual([['xlsx'], ['docx'], undefined])
  })

  test("denies an MCP server's tools to agent steps only", () => {
    const out = withoutContextItem(w, { kind: 'mcp', name: 'playwright' })
    expect(out.nodes.map((n) => n.config.tools?.deny)).toEqual([['mcp__playwright'], ['mcp__playwright'], undefined])
  })
})
