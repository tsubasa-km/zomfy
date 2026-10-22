import type { DiscoveredSkill, SkillDiscoveryResult, SkillSourceKind } from '@acp-harness/protocol'

// Orca's skills-filter.ts, skill-agent-filter.ts and skill-display-labels.ts.

export type SkillsFilterState = {
  query: string
  sourceKind: SkillSourceKind | 'all'
  /** Owning agent id, or 'all'. Resolved from the root a skill was found in. */
  agent: string
}

export const NO_SKILL_FILTERS: SkillsFilterState = { query: '', sourceKind: 'all', agent: 'all' }

export const SKILL_SOURCE_KINDS: SkillSourceKind[] = ['home', 'repo', 'bundled', 'plugin']

/** Roots like `.agents/skills` that every agent reads, so no single one owns them. */
const SHARED_SKILL_AGENT = 'shared'

const AGENT_LABELS: Record<string, string> = {
  [SHARED_SKILL_AGENT]: 'Shared (.agents)',
  claude: 'Claude Code',
  codex: 'Codex',
  cursor: 'Cursor',
  gemini: 'Gemini CLI',
  droid: 'Droid',
  continue: 'Continue',
  trae: 'Trae',
  grok: 'Grok',
  aug: 'Augment',
  zcode: 'ZCode',
  codebuddy: 'CodeBuddy',
  qoder: 'Qoder',
  kiro: 'Kiro',
  antigravity: 'Antigravity',
  opencode: 'OpenCode',
  pi: 'Pi',
  omp: 'OMP',
  hermes: 'Hermes',
  'prime-agent': 'Prime Agent',
  muse: 'Muse'
}

export function skillAgentLabel(agentId: string): string {
  return AGENT_LABELS[agentId] ?? agentId
}

// 'repo' roots also come from folder projects, so Orca calls them "Workspace".
export function sourceKindLabel(kind: SkillSourceKind): string {
  return { home: 'Home', repo: 'Workspace', bundled: 'Bundled', plugin: 'Plugin' }[kind]
}

export const PROVIDER_LABELS = { codex: 'Codex', claude: 'Claude', 'agent-skills': 'Agent Skills' } as const

export function countLabel(count: number, one: string, other: string): string {
  return `${count} ${count === 1 ? one : other}`
}

/** Discovery tags most roots as `agent-skills`; the owning agent comes from the root. */
export function skillAgentByRootPath(result: SkillDiscoveryResult | null): ReadonlyMap<string, string> {
  return new Map((result?.sources ?? []).map((source) => [source.path, source.owner ?? SHARED_SKILL_AGENT]))
}

function skillRoots(skill: DiscoveredSkill): string[] {
  return skill.rootPaths?.length ? skill.rootPaths : [skill.rootPath]
}

export function skillAgents(skill: DiscoveredSkill, agentByRootPath: ReadonlyMap<string, string>): string[] {
  return [...new Set(skillRoots(skill).map((root) => agentByRootPath.get(root)).filter((a): a is string => !!a))]
}

/** Only agents that actually hold a skill; an empty root is not a filter. */
export function skillAgentOptions(result: SkillDiscoveryResult | null): { id: string; label: string; count: number }[] {
  const byRoot = skillAgentByRootPath(result)
  const counts = new Map<string, number>()
  for (const skill of result?.skills ?? []) {
    for (const agent of skillAgents(skill, byRoot)) counts.set(agent, (counts.get(agent) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([id, count]) => ({ id, label: skillAgentLabel(id), count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
}

export function filterSkills(
  skills: readonly DiscoveredSkill[],
  filters: SkillsFilterState,
  agentByRootPath: ReadonlyMap<string, string>
): DiscoveredSkill[] {
  const query = filters.query.trim().toLowerCase()
  return skills.filter((skill) => {
    if (filters.sourceKind !== 'all' && skill.sourceKind !== filters.sourceKind) return false
    if (filters.agent !== 'all' && !skillRoots(skill).some((root) => agentByRootPath.get(root) === filters.agent)) return false
    if (!query) return true
    return [skill.name, skill.description ?? '', skill.sourceLabel, skill.directoryPath, skill.providers.join(' ')]
      .join(' ')
      .toLowerCase()
      .includes(query)
  })
}

export function countSkillsBySource(skills: readonly DiscoveredSkill[]): Record<SkillSourceKind, number> {
  const counts: Record<SkillSourceKind, number> = { home: 0, repo: 0, bundled: 0, plugin: 0 }
  for (const skill of skills) counts[skill.sourceKind] += 1
  return counts
}

/** Orca refuses these: bundled skills come back, plugin skills belong to their plugin. */
export function skillDeleteBlockReason(skill: DiscoveredSkill): string | null {
  if (skill.sourceKind === 'bundled') return 'Bundled with the agent — it would be restored'
  if (skill.sourceKind === 'plugin') return 'Installed by a plugin — remove the plugin instead'
  return null
}
