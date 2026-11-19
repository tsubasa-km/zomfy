import { describe, expect, test } from 'bun:test'
import type { DiscoveredSkill, SkillDiscoveryResult, SkillDiscoverySource } from '@acp-harness/protocol'
import { skillCopyTargets } from '../src/components/skills/skills-filter.ts'

const source = (id: string, path: string, kind: SkillDiscoverySource['sourceKind'], owner: string | null, exists: boolean, label = id): SkillDiscoverySource => ({
  id,
  label,
  path,
  sourceKind: kind,
  providers: ['agent-skills'],
  owner,
  exists
})

const skill = (name: string, root: string): DiscoveredSkill => ({
  id: `${root}/${name}`,
  name,
  description: null,
  providers: ['claude'],
  sourceKind: 'home',
  sourceLabel: root,
  rootPath: root,
  rootPaths: [root],
  directoryPath: `${root}/${name}`,
  skillFilePath: `${root}/${name}/SKILL.md`,
  updatedAt: null
})

describe('skillCopyTargets', () => {
  const pdf = skill('pdf', '/h/.claude/skills')
  const result: SkillDiscoveryResult = {
    skills: [pdf, skill('pdf', '/h/.cursor/skills')],
    sources: [
      source('home-claude', '/h/.claude/skills', 'home', 'claude', true),
      source('home-codex', '/h/.codex/skills', 'home', 'codex', false),
      source('home-agents', '/h/.agents/skills', 'home', null, false),
      source('home-cursor', '/h/.cursor/skills', 'home', 'cursor', true),
      source('home-kiro', '/h/.kiro/skills', 'home', 'kiro', false),
      source('repo-claude-x', '/p/.claude/skills', 'repo', 'claude', true, 'Repo app .claude'),
      source('repo-agents-x', '/p/.agents/skills', 'repo', null, false, 'Repo app .agents'),
      source('plugin-y', '/h/.claude/plugins/y/skills', 'plugin', 'claude', true)
    ],
    scannedAt: 0
  }

  test('offers the main agents and folders that exist, never plugin ones', () => {
    const ids = skillCopyTargets(pdf, result).map((t) => t.sourceId)
    expect(ids).toContain('home-codex')
    expect(ids).toContain('home-agents')
    expect(ids).toContain('repo-claude-x')
    expect(ids).not.toContain('home-kiro')
    expect(ids).not.toContain('repo-agents-x')
    expect(ids).not.toContain('plugin-y')
  })

  test('marks where it is already, by its own root or a same-named folder', () => {
    const has = Object.fromEntries(skillCopyTargets(pdf, result).map((t) => [t.sourceId, t.has]))
    expect(has['home-claude']).toBe(true)
    expect(has['home-cursor']).toBe(true)
    expect(has['home-codex']).toBe(false)
  })

  test('reads Windows paths too', () => {
    const win = (root: string): DiscoveredSkill => ({ ...skill('demo', root), directoryPath: `${root}\\demo`, skillFilePath: `${root}\\demo\\SKILL.md` })
    const claude = win('C:\\p\\.claude\\skills')
    const agents = win('C:\\p\\.agents\\skills')
    const targets = skillCopyTargets(claude, {
      skills: [claude, agents],
      sources: [source('repo-agents-p', 'C:\\p\\.agents\\skills', 'repo', null, true, 'Repo p .agents')],
      scannedAt: 0
    })
    expect(targets[0]?.has).toBe(true)
  })

  test('names a project folder by its project', () => {
    expect(skillCopyTargets(pdf, result).find((t) => t.sourceId === 'repo-claude-x')?.scope).toBe('app')
  })
})
