import { afterAll, beforeAll, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { git } from './git-cli.ts'
import { gitRepositories, repositoryRoot } from './git-repositories.ts'
import { gitStatus } from './git-changes.ts'
import { readWorkspaceFileRevision } from './workspace-file-bytes.ts'

// A workspace whose repository ignores a folder that is a repository of its own (kept apart, not a
// submodule): the Source Control tab finds both and works in each.

let root = ''
// Git is slow to start on Windows: one workspace for all the tests.
beforeAll(async () => {
  root = await workspace()
}, 60_000)
afterAll(async () => {
  await rm(root, { recursive: true, force: true })
})

async function repo(dir: string, file: string, content: string): Promise<void> {
  await mkdir(dir, { recursive: true })
  await git(dir, ['init', '-q', '-b', 'main'])
  await writeFile(join(dir, file), content)
  await git(dir, ['add', '.'])
  await git(dir, ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'init'])
}

async function workspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'git-repositories-'))
  await mkdir(join(root, 'inner'), { recursive: true })
  await writeFile(join(root, '.gitignore'), '/inner/\n/apps/node_modules/\n')
  await repo(root, 'a.txt', 'outer\n')
  await repo(join(root, 'inner'), 'b.txt', 'inner\n')
  await repo(join(root, 'apps', 'web'), 'c.txt', 'web\n')
  // Dependencies and hidden folders are not looked in.
  await repo(join(root, 'apps', 'node_modules', 'dep'), 'd.txt', 'dep\n')
  await repo(join(root, '.cache', 'tool'), 'e.txt', 'tool\n')
  return root
}

test('finds the workspace repository and the ones below it', async () => {
  const repos = await gitRepositories(root)
  expect(repos).toEqual([
    { path: '', branch: 'main' },
    { path: 'inner', branch: 'main' },
    { path: 'apps/web', branch: 'main' }
  ])
})

test("a repository below the workspace has its own changes, and its files' committed copies", async () => {
  await writeFile(join(root, 'inner', 'b.txt'), 'changed\n')
  expect((await gitStatus(root)).unstaged.map((c) => c.path)).not.toContain('inner/b.txt')
  const inner = await repositoryRoot(root, 'inner')
  expect((await gitStatus(inner)).unstaged.map((c) => c.path)).toEqual(['b.txt'])
  const committed = await readWorkspaceFileRevision(root, { workspaceId: 'w', path: 'inner/b.txt', revision: 'HEAD' })
  expect(committed.content).toBe('inner\n')
})

test('refuses a folder outside the workspace or without its own repository', async () => {
  await mkdir(join(root, 'plain'))
  expect(repositoryRoot(root, '../elsewhere')).rejects.toThrow('not inside the workspace')
  expect(repositoryRoot(root, 'plain')).rejects.toThrow('not a git repository')
  expect(await repositoryRoot(root, undefined)).toBe(root)
})
