import { describe, expect, test } from 'bun:test'
import { githubCreateArgs, githubHosting, githubSearchQuery, mapRollupItem } from './github-hosting.ts'
import { gitlabCreateArgs, gitlabHosting, mapJob, mapMergeRequest } from './gitlab-hosting.ts'
import type { HostingRunner } from './hosting-cli.ts'
import type { HostingContext } from './hosting-provider.ts'
import { parseRemoteUrl } from './hosting-remote.ts'

// Write paths are only ever exercised against a recording runner, never a real host.

function recordingContext(provider: 'github' | 'gitlab', host: string, path: string) {
  const calls: { tool: string; args: string[] }[] = []
  const run: HostingRunner = async (tool, _cwd, args) => {
    calls.push({ tool, args })
    return tool === 'gh' ? 'https://github.com/o/r/pull/7\n' : 'Creating merge request\nhttps://gitlab.example.com/g/p/-/merge_requests/3\n'
  }
  const ctx: HostingContext = { cwd: '.', remote: { provider, host, path, remote: 'origin' }, run }
  return { ctx, calls }
}

describe('create review commands', () => {
  test('gh pr create runs with an explicit repo, base, head and body file', async () => {
    const { ctx, calls } = recordingContext('github', 'github.com', 'o/r')
    const url = await githubHosting.createReview(ctx, { title: 'T "q"', body: 'B', base: 'main', head: 'me/feat', draft: true })
    expect(url).toBe('https://github.com/o/r/pull/7')
    const args = calls[0]!.args
    expect(args.slice(0, 10)).toEqual(['pr', 'create', '-R', 'o/r', '--base', 'main', '--head', 'me/feat', '--title', 'T "q"'])
    expect(args[10]).toBe('--body-file')
    expect(args.at(-1)).toBe('--draft')
    expect(githubCreateArgs({ ...ctx, remote: { ...ctx.remote, host: 'ghe.corp' } }, { title: 't', base: 'b', head: 'h', draft: false }, 'f')).toEqual(
      ['pr', 'create', '-R', 'ghe.corp/o/r', '--base', 'b', '--head', 'h', '--title', 't', '--body-file', 'f']
    )
  })

  test('glab mr create names a self-managed host by URL', async () => {
    const { ctx, calls } = recordingContext('gitlab', 'gitlab.example.com', 'g/p')
    const url = await gitlabHosting.createReview(ctx, { title: 'T', body: 'line1\nline2', base: 'main', head: 'feat', draft: false })
    expect(url).toBe('https://gitlab.example.com/g/p/-/merge_requests/3')
    expect(calls[0]!.args).toEqual(
      gitlabCreateArgs(ctx, { title: 'T', body: 'line1\nline2', base: 'main', head: 'feat', draft: false })
    )
    expect(calls[0]!.args).toEqual([
      'mr', 'create', '-R', 'https://gitlab.example.com/g/p', '--source-branch', 'feat', '--target-branch', 'main',
      '--title', 'T', '--description', 'line1\nline2', '--yes'
    ])
  })
})

describe('mapping', () => {
  test('remote URLs', () => {
    expect(parseRemoteUrl('git@github.com:o/r.git')).toEqual({ host: 'github.com', path: 'o/r' })
    expect(parseRemoteUrl('https://gitlab.example.com/g/sub/p.git')).toEqual({ host: 'gitlab.example.com', path: 'g/sub/p' })
    expect(parseRemoteUrl('ssh://git@gitlab.example.com:2222/g/p.git')).toEqual({ host: 'gitlab.example.com', path: 'g/p' })
    expect(parseRemoteUrl('/local/path')).toBeNull()
  })

  test('GitHub check runs and status contexts', () => {
    expect(mapRollupItem({ __typename: 'CheckRun', name: 'ci', status: 'IN_PROGRESS', conclusion: '' }).conclusion).toBe('pending')
    expect(mapRollupItem({ __typename: 'CheckRun', name: 'ci', status: 'COMPLETED', conclusion: 'FAILURE' }).conclusion).toBe('failure')
    expect(mapRollupItem({ __typename: 'StatusContext', context: 'ci/x', state: 'PENDING' }).status).toBe('in_progress')
    expect(githubSearchQuery('review', 'review-requested', 'bug')).toBe('is:open review-requested:@me bug sort:updated-desc')
  })

  test('GitLab merge requests and jobs', () => {
    const mr = mapMergeRequest({
      iid: 3,
      title: 'Draft: x',
      state: 'opened',
      draft: true,
      web_url: 'u',
      source_branch: 'feat',
      target_branch: 'main',
      head_pipeline: { status: 'running' },
      source_project_id: 1,
      target_project_id: 1
    })
    expect(mr.state).toBe('draft')
    expect(mr.checksStatus).toBe('pending')
    expect(mr.isCrossRepository).toBe(false)
    expect(mapJob({ name: 'lint', status: 'failed', allow_failure: true }).conclusion).toBe('neutral')
    expect(mapJob({ name: 'test', status: 'running' }).status).toBe('in_progress')
  })
})
