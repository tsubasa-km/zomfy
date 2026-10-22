import { describe, expect, test } from 'bun:test'
import { classifyLinkHref, workspaceRelativePath } from '../src/lib/link-targets.ts'

describe('classifyLinkHref', () => {
  test('web, system, anchor and blocked schemes', () => {
    expect(classifyLinkHref('https://example.com/a?b=1')).toEqual({ kind: 'web', url: 'https://example.com/a?b=1' })
    expect(classifyLinkHref('HTTP://x.dev')).toEqual({ kind: 'web', url: 'HTTP://x.dev' })
    expect(classifyLinkHref('//cdn.example.com/x')).toEqual({ kind: 'web', url: 'https://cdn.example.com/x' })
    expect(classifyLinkHref('mailto:a@b.c')).toEqual({ kind: 'system', url: 'mailto:a@b.c' })
    expect(classifyLinkHref('#section')).toEqual({ kind: 'anchor' })
    expect(classifyLinkHref('javascript:alert(1)')).toEqual({ kind: 'blocked' })
    expect(classifyLinkHref('data:text/html,hi')).toEqual({ kind: 'blocked' })
  })

  test('paths with line locations', () => {
    expect(classifyLinkHref('src/a.ts')).toEqual({ kind: 'file', path: 'src/a.ts' })
    expect(classifyLinkHref('src/a.ts:12')).toEqual({ kind: 'file', path: 'src/a.ts', line: 12 })
    expect(classifyLinkHref('src/a.ts:12:4')).toEqual({ kind: 'file', path: 'src/a.ts', line: 12 })
    expect(classifyLinkHref('src/a.ts#L7')).toEqual({ kind: 'file', path: 'src/a.ts', line: 7 })
    expect(classifyLinkHref('src/my%20file.md')).toEqual({ kind: 'file', path: 'src/my file.md' })
    expect(classifyLinkHref(String.raw`C:\repo\a.ts`)).toEqual({ kind: 'file', path: String.raw`C:\repo\a.ts` })
    expect(classifyLinkHref('file:///C:/repo/a.ts')).toEqual({ kind: 'file', path: 'C:/repo/a.ts' })
    expect(classifyLinkHref('file:///home/me/repo/a.ts:3')).toEqual({ kind: 'file', path: '/home/me/repo/a.ts', line: 3 })
  })
})

describe('workspaceRelativePath', () => {
  test('relative paths stay inside the workspace', () => {
    expect(workspaceRelativePath('./src/a.ts', '/repo')).toBe('src/a.ts')
    expect(workspaceRelativePath('../other/a.ts', '/repo')).toBeNull()
  })
  test('absolute paths under the root', () => {
    expect(workspaceRelativePath('/repo/src/a.ts', '/repo/')).toBe('src/a.ts')
    expect(workspaceRelativePath('/repository/a.ts', '/repo')).toBeNull()
    expect(workspaceRelativePath(String.raw`c:\Repo\src\a.ts`, String.raw`C:\repo`)).toBe('src/a.ts')
    expect(workspaceRelativePath('/etc/hosts', '/repo')).toBeNull()
  })
})
