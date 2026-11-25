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
  skillCopy: '_harness/skills/copy',
  bundledList: '_harness/skills/bundledList',
  bundledSet: '_harness/skills/bundledSet',
  bundledReplace: '_harness/skills/bundledReplace'
} as const

/**
 * How the host's copy of a bundled skill compares with this release's: `current`; `older` (a
 * version Zomfy shipped before, updated on start); `edited` (changed by hand, left alone); `missing`.
 */
export type BundledSkillCopyState = 'current' | 'older' | 'edited' | 'missing'

/** One agent's switch for a bundled skill in a project. */
export interface BundledSkillAgent {
  /** 'claude' or 'codex'. */
  agent: string
  label: string
  enabled: boolean
  /**
   * Workspaces of the project whose agent folder holds something else by the skill's name (a folder
   * of the person's own), which Zomfy leaves alone.
   */
  blocked: number
}

/** A skill Zomfy ships, as a project sees it (spec worktree-skills-and-storage A). */
export interface BundledSkill {
  name: string
  description: string
  /** The host's shared copy, which every enabled project links to. */
  copyPath: string
  copyState: BundledSkillCopyState
  agents: BundledSkillAgent[]
}

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
  /** Zomfy's bundled skills and their switches in one project. Newer daemons only. */
  [SKILL_METHODS.bundledList]: { params: { projectId: string }; result: BundledSkill[] }
  /** Turns a bundled skill on or off for one agent in a project: links or unlinks it in every workspace. */
  [SKILL_METHODS.bundledSet]: { params: { projectId: string; name: string; agent: string; enabled: boolean }; result: BundledSkill[] }
  /** Replaces an edited shared copy with this release's, after moving it to `~/.zomfy/skill-backups`. */
  [SKILL_METHODS.bundledReplace]: { params: { projectId: string; name: string }; result: BundledSkill[] }
}
