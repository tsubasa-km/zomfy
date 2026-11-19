// Orca's Skills page (shared/skills.ts): the agent skills a daemon host can see. Discovery runs on
// that host, so a WSL or SSH host lists its own home and project skill folders.

export type SkillProvider = 'codex' | 'claude' | 'agent-skills'

export type SkillSourceKind = 'home' | 'repo' | 'bundled' | 'plugin'

export interface DiscoveredSkill {
  id: string
  name: string
  description: string | null
  providers: SkillProvider[]
  sourceKind: SkillSourceKind
  sourceLabel: string
  rootPath: string
  /** Every root that reached this file; symlinked skills keep each owning agent. */
  rootPaths?: string[]
  directoryPath: string
  skillFilePath: string
  updatedAt: number | null
}

export interface SkillDiscoverySource {
  id: string
  label: string
  path: string
  sourceKind: SkillSourceKind
  providers: SkillProvider[]
  /** Agent id owning this root; null for the shared `.agents/skills` roots. */
  owner: string | null
  exists: boolean
}

export interface SkillDiscoveryResult {
  skills: DiscoveredSkill[]
  sources: SkillDiscoverySource[]
  scannedAt: number
}

export const SKILL_METHODS = {
  skillsDiscover: '_harness/skills/discover',
  skillRead: '_harness/skills/read',
  skillTrash: '_harness/skills/trash',
  skillCopy: '_harness/skills/copy'
} as const

/** What copying a skill into one skill folder came to. */
export interface SkillCopyOutcome {
  /** A source id from the scan: the skill folder it went to. */
  sourceId: string
  status: 'copied' | 'exists' | 'failed'
  error?: string
}

export interface SkillRequests {
  [SKILL_METHODS.skillsDiscover]: { params: Record<string, never>; result: SkillDiscoveryResult }
  /** SKILL.md text; only paths a scan returned are readable. */
  [SKILL_METHODS.skillRead]: { params: { skillFilePath: string }; result: { content: string; truncated: boolean } }
  /** Moves a home or workspace skill's folder to the host's trash. */
  [SKILL_METHODS.skillTrash]: { params: { skillFilePath: string }; result: Record<string, never> }
  /**
   * Copies a skill's folder into other agents' skill folders (source ids from the scan), so those
   * agents load it too. A folder that already has one by that name keeps its own.
   */
  [SKILL_METHODS.skillCopy]: { params: { skillFilePath: string; sourceIds: string[] }; result: { outcomes: SkillCopyOutcome[] } }
}
