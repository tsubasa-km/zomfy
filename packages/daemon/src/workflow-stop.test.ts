import { afterEach, beforeEach, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Workflow, WorkflowRun } from '@acp-harness/protocol'
import { WorkflowEngine } from './workflow-engine.ts'
import type { WorkflowRunStore } from './workflow-run-store.ts'
import type { WorkflowStore } from './workflow-store.ts'
import type { WorkflowAgentStore } from './workflow-agent-store.ts'

// Stop reaches a running check: its command process ends and its step is closed as stopped.

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'wf-stop-'))
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

test('Stop kills a running check command and closes its step', async () => {
  const marker = join(dir, 'marker')
  // Writes the marker after 3s, unless it is killed first.
  const script = `await Bun.sleep(3000); await Bun.write(${JSON.stringify(marker)}, "x")`
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
      { id: 'b', from: 'tests', to: 'done', outcome: 'pass' },
      { id: 'c', from: 'tests', to: 'done', outcome: 'fail' }
    ],
    updatedAt: 0
  }
  const { engine: wf, runs } = engine(workflow)
  const run = await wf.start('p', 'w', 'stop it')
  await Bun.sleep(700)
  expect(runs.get(run.id)?.steps.at(-1)?.endedAt).toBeNull()

  const stopped = await wf.stop(run.id)
  expect(stopped.status).toBe('stopped')
  expect(stopped.steps.every((s) => s.endedAt !== null)).toBe(true)
  expect(stopped.steps.at(-1)?.error).toBe('Stopped')

  await Bun.sleep(3500)
  expect(existsSync(marker)).toBe(false)
  expect(runs.get(run.id)?.status).toBe('stopped')
}, 15_000)
