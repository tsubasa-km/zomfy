import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Workflow, WorkflowRun } from '@acp-harness/protocol'
import { WorkflowEngine } from './workflow-engine.ts'
import type { WorkflowRunStore } from './workflow-run-store.ts'
import type { WorkflowStore } from './workflow-store.ts'
import type { WorkflowAgentStore } from './workflow-agent-store.ts'

// A run that fails partway is marked interrupted and can be resumed at that step; one the daemon
// restarted under is too. Resuming runs the step again and the run goes on to its end.

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'wf-resume-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true }).catch(() => undefined)
})

function engine(workflow: Workflow) {
  const runs = new Map<string, WorkflowRun>()
  const runStore = {
    all: async () => [...runs.values()],
    get: async (id: string) => runs.get(id) ?? null,
    save: async (run: WorkflowRun) => void runs.set(run.id, structuredClone(run))
  }
  const deps = {
    workspaces: {
      snapshot: async () => ({
        projects: [{ id: 'p', name: 'p', path: dir, kind: 'folder' }],
        workspaces: [{ id: 'main', projectId: 'p', name: 'p', path: dir, branch: null, isPrimary: true, createdAt: 0 }]
      }),
      workspacePath: () => dir
    },
    sessions: { get: () => undefined },
    pendingTurns: new Map(),
    broadcast: () => undefined,
    runStepTurn: async () => {
      throw new Error('no agents in this test')
    },
    emit: async () => undefined,
    serveTool: () => undefined,
    autoApprove: new Set(),
    acpAgents: {}
  }
  return {
    runs,
    // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: the engine uses only the fields faked above.
    engine: new WorkflowEngine(
      deps as unknown as ConstructorParameters<typeof WorkflowEngine>[0],
      runStore as unknown as WorkflowRunStore,
      { list: async () => [workflow] } as unknown as WorkflowStore,
      { list: async () => [] } as unknown as WorkflowAgentStore
    )
  }
}

async function settled(engine: WorkflowEngine, runId: string): Promise<WorkflowRun> {
  return Promise.race([engine.ended(runId), Bun.sleep(15_000).then(() => Promise.reject(new Error('the run did not end')))])
}

test('a run that failed partway resumes at that step and finishes', async () => {
  const ready = join(dir, 'ready')
  // Passes only once the marker exists; with no "fail" edge, the first try fails the run.
  const script = `process.exit(require("fs").existsSync(${JSON.stringify(ready)}) ? 0 : 1)`
  const command = `"${process.execPath}" -e ${process.platform === 'win32' ? `"${script.replace(/"/g, '\\"')}"` : `'${script}'`}`
  const workflow: Workflow = {
    id: 'w',
    projectId: 'p',
    name: 'w',
    nodes: [
      { id: 'start', kind: 'start', label: 'Start', x: 0, y: 0, config: {} },
      { id: 'tests', kind: 'check', label: 'Tests', x: 100, y: 0, config: { command } },
      { id: 'done', kind: 'end', label: 'Done', x: 200, y: 0, config: {} }
    ],
    edges: [
      { id: 'a', from: 'start', to: 'tests', outcome: 'next' },
      { id: 'b', from: 'tests', to: 'done', outcome: 'pass' }
    ],
    updatedAt: 0
  }
  const { engine: wf } = engine(workflow)
  const run = await wf.start('p', 'w', 'check it')
  const failed = await settled(wf, run.id)
  expect(failed.status).toBe('failed')
  expect(failed.interrupted).toBe(true)
  expect((await wf.interrupted()).map((r) => r.id)).toEqual([run.id])

  await writeFile(ready, 'x')
  const resumed = await wf.resume(run.id)
  expect(resumed.status).toBe('running')
  expect(resumed.interrupted).toBeUndefined()
  const done = await settled(wf, run.id)
  expect(done.status).toBe('done')
  expect(done.steps.filter((s) => s.nodeId === 'tests').map((s) => s.outcome)).toEqual(['fail', 'pass'])
  expect(await wf.interrupted()).toEqual([])
  await expect(wf.resume(run.id)).rejects.toThrow('stopped or failed partway')
})

test('a run the daemon restarted under is interrupted and resumable', async () => {
  const workflow: Workflow = {
    id: 'w',
    projectId: 'p',
    name: 'w',
    nodes: [
      { id: 'start', kind: 'start', label: 'Start', x: 0, y: 0, config: {} },
      { id: 'dev', kind: 'agent', label: 'Developer', x: 100, y: 0, config: {} },
      { id: 'done', kind: 'end', label: 'Done', x: 200, y: 0, config: {} }
    ],
    edges: [
      { id: 'a', from: 'start', to: 'dev', outcome: 'next' },
      { id: 'b', from: 'dev', to: 'done', outcome: 'next' }
    ],
    updatedAt: 0
  }
  const { engine: wf, runs } = engine(workflow)
  const left: WorkflowRun = {
    id: 'r',
    workflowId: 'w',
    projectId: 'p',
    workflow,
    task: 't',
    status: 'running',
    currentNodeId: 'dev',
    workspaceId: 'main',
    rounds: {},
    sessionsByNode: {},
    steps: [{ id: 's', nodeId: 'dev', label: 'Developer', startedAt: 1, endedAt: null, outcome: null, summary: '', sessionIds: [] }],
    waiting: null,
    createdAt: 1,
    endedAt: null
  }
  runs.set('r', left)
  await wf.recover()
  const recovered = runs.get('r')!
  expect(recovered.status).toBe('stopped')
  expect(recovered.interrupted).toBe(true)
  expect((await wf.interrupted()).map((r) => r.id)).toEqual(['r'])
})
