import type { Workflow, WorkflowNode, WorkflowNodeKind, WorkflowOutcome } from '@acp-harness/protocol'
import { blankWorkflow, leadCycleTemplate, newNode, reviewLoopTemplate } from './workflow-model'

// Workflows to start from, from a straight line to nested loops, so the shapes can be compared side by side.

export interface WorkflowTemplate {
  name: string
  hint: string
  make: (projectId: string) => Workflow
}

type Draft = Pick<Workflow, 'name' | 'description'> & {
  steps: Record<string, [WorkflowNodeKind, string, number, number, WorkflowNode['config']?]>
  edges: [string, string, WorkflowOutcome][]
}

function build(projectId: string, draft: Draft): Workflow {
  const nodes = Object.fromEntries(
    Object.entries(draft.steps).map(([key, [kind, label, x, y, config]]) => {
      const base = newNode(kind, x, y)
      return [key, { ...base, label, config: { ...base.config, ...config } }]
    })
  )
  return {
    id: crypto.randomUUID(),
    projectId,
    name: draft.name,
    ...(draft.description ? { description: draft.description } : {}),
    nodes: Object.values(nodes),
    edges: draft.edges.map(([from, to, outcome]) => ({ id: crypto.randomUUID(), from: nodes[from]!.id, to: nodes[to]!.id, outcome })),
    updatedAt: Date.now()
  }
}

const DEVELOP = 'Implement the task in this worktree. Commit when done. Address every review finding you are given.'
const REVIEW = "Review the changes on this branch for correctness and the task's intent. Do not edit files."

const straightLine = (projectId: string) =>
  build(projectId, {
    name: 'Straight line',
    description: 'No loop: a developer implements, tests run once, and the run ends either way.',
    steps: {
      start: ['start', 'Task from the person', 0, 120],
      dev: ['agent', 'Developer', 280, 120, { prompt: DEVELOP }],
      tests: ['check', 'Run tests', 560, 120, { command: '' }],
      done: ['end', 'Done', 840, 40],
      failed: ['end', 'Tests failed', 840, 200, { result: 'failed' }]
    },
    edges: [
      ['start', 'dev', 'next'],
      ['dev', 'tests', 'next'],
      ['tests', 'done', 'pass'],
      ['tests', 'failed', 'fail']
    ]
  })

const testFirst = (projectId: string) =>
  build(projectId, {
    name: 'Test first',
    description: 'One small loop: tests are written first, then the implementation goes round until they pass.',
    steps: {
      start: ['start', 'Task from the person', 0, 120],
      write: ['agent', 'Write tests', 280, 120, { role: 'Test writer', prompt: 'Write tests that pin down the task. They should fail now. Commit them.' }],
      impl: ['agent', 'Implement', 560, 120, { prompt: 'Make the tests pass without changing what they check. Commit when done.' }],
      tests: ['check', 'Run tests', 840, 120, { command: '' }],
      done: ['end', 'Done', 1120, 120]
    },
    edges: [
      ['start', 'write', 'next'],
      ['write', 'impl', 'next'],
      ['impl', 'tests', 'next'],
      ['tests', 'done', 'pass'],
      ['tests', 'impl', 'fail']
    ]
  })

const threeReviewers = (projectId: string) =>
  build(projectId, {
    name: 'Three reviewers',
    description: 'Develop ⇄ review, where three reviewers look independently and the majority decides.',
    steps: {
      start: ['start', 'Task from the person', 0, 120],
      dev: ['agent', 'Developer', 280, 120, { prompt: DEVELOP }],
      tests: ['check', 'Run tests', 560, 120, { command: '' }],
      review: ['review', 'Reviewers', 840, 120, { prompt: REVIEW, parallel: { count: 3, join: 'majority' }, tools: { readOnly: true } }],
      done: ['end', 'Done', 1120, 120]
    },
    edges: [
      ['start', 'dev', 'next'],
      ['dev', 'tests', 'next'],
      ['tests', 'review', 'pass'],
      ['tests', 'dev', 'fail'],
      ['review', 'done', 'approve'],
      ['review', 'dev', 'changes']
    ]
  })

const splitWork = (projectId: string) =>
  build(projectId, {
    name: 'Split the work',
    description: 'Your chat plans; the developer splits the plan across up to three helper agents, integrates their work, then tests and review.',
    steps: {
      start: ['start', 'Task from the person', 0, 120],
      plan: [
        'agent',
        'Plan (your chat)',
        280,
        120,
        { runBy: 'lead', role: 'Lead', prompt: 'Break the task into independent parts with the files each part owns, and how to check the whole.' }
      ],
      dev: [
        'agent',
        'Developer',
        560,
        120,
        {
          maxAgents: 3,
          prompt: "Run the plan's independent parts in parallel with spawn_agents, then integrate, check the whole and commit. Address every review finding you are given."
        }
      ],
      tests: ['check', 'Run tests', 840, 120, { command: '' }],
      review: ['review', 'Reviewer', 1120, 120, { prompt: REVIEW, tools: { readOnly: true } }],
      done: ['end', 'Done', 1400, 120]
    },
    edges: [
      ['start', 'plan', 'next'],
      ['plan', 'dev', 'next'],
      ['dev', 'tests', 'next'],
      ['tests', 'review', 'pass'],
      ['tests', 'dev', 'fail'],
      ['review', 'done', 'approve'],
      ['review', 'dev', 'changes']
    ]
  })

export const WORKFLOW_TEMPLATES: WorkflowTemplate[] = [
  { name: 'Straight line', hint: 'No loop', make: straightLine },
  { name: 'Develop and review', hint: 'One loop', make: reviewLoopTemplate },
  { name: 'Test first', hint: 'A small loop', make: testFirst },
  { name: 'Three reviewers', hint: 'One loop, reviewers in parallel', make: threeReviewers },
  { name: 'Plan, build, check', hint: 'Nested loops', make: leadCycleTemplate },
  { name: 'Split the work', hint: 'Helper agents', make: splitWork },
  { name: 'Blank', hint: 'Start only', make: blankWorkflow }
]
