import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { appendFile, lstat, mkdir, readFile, readlink, realpath, rename, rm, symlink, unlink, writeFile, cp } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import type { BundledSkill, BundledSkillCopyState, Project, Workspace } from '@zomfy/protocol'
import { git } from './git-cli.ts'
import { log } from './log.ts'
import zomfyWorktrees from '../resources/skills/zomfy-worktrees/SKILL.md' with { type: 'text' }

// Zomfy's own skills (spec worktree-skills-and-storage A, with the person's decision: per project
// and per agent). The host keeps one shared copy of each under `<harness home>/skills/<name>`; a
// project that turns a skill on gets a link to it (a junction on Windows) in the chosen agents'
// skill folders of each of its workspaces, kept out of git through `info/exclude`. An update rewrites
// the shared copy only when it is an unedited earlier version, recognised by its digest.

export interface BundledSkillDefinition {
  name: string
  description: string
  content: string
  /** sha256 (LF line ends) of every SKILL.md this skill has shipped with, the current one included. */
  shipped: string[]
}

export const BUNDLED_SKILLS: BundledSkillDefinition[] = [
  {
    name: 'zomfy-worktrees',
    description: "Work in git worktrees through Zomfy's harness tools instead of raw git or another tool's CLI.",
    content: zomfyWorktrees,
    shipped: ['5f8567d991a7df5617c8eecab5ae40262d5ed6e083f46d0c88a0b7db09d6169e']
  }
]

/** Agents whose project skill folders Zomfy links into. */
export const SKILL_AGENTS: { agent: string; label: string; folder: string[] }[] = [
  { agent: 'claude', label: 'Claude Code', folder: ['.claude', 'skills'] },
  { agent: 'codex', label: 'Codex', folder: ['.agents', 'skills'] }
]

export function skillDigest(text: string): string {
  return createHash('sha256').update(text.replace(/\r\n/g, '\n')).digest('hex')
}

export interface BundledSkillsDeps {
  /** `<harness home>/skills`. */
  copyRoot: string
  /** `<harness home>/skill-backups`. */
  backupRoot: string
  skills?: BundledSkillDefinition[]
  now?: () => number
}

type LinkState = 'linked' | 'absent' | 'blocked'

export class BundledSkills {
  private readonly skills: BundledSkillDefinition[]

  constructor(private readonly deps: BundledSkillsDeps) {
    this.skills = deps.skills ?? BUNDLED_SKILLS
  }

  private skill(name: string): BundledSkillDefinition {
    const skill = this.skills.find((s) => s.name === name)
    if (!skill) throw new Error(`Zomfy has no bundled skill ${name}`)
    return skill
  }

  copyPath(name: string): string {
    return join(this.deps.copyRoot, name)
  }

  async copyState(name: string): Promise<BundledSkillCopyState> {
    const skill = this.skill(name)
    const text = await readFile(join(this.copyPath(name), 'SKILL.md'), 'utf8').catch(() => null)
    if (text === null) return 'missing'
    const digest = skillDigest(text)
    if (digest === skillDigest(skill.content)) return 'current'
    return skill.shipped.includes(digest) ? 'older' : 'edited'
  }

  /** Writes the shared copy when it is missing or an unedited earlier version; an edited one stays. */
  async ensureCopy(name: string): Promise<BundledSkillCopyState> {
    const state = await this.copyState(name)
    if (state === 'missing' || state === 'older') {
      await mkdir(this.copyPath(name), { recursive: true })
      await writeFile(join(this.copyPath(name), 'SKILL.md'), this.skill(name).content)
      if (state === 'older') log(`updated the bundled skill ${name}`)
      return 'current'
    }
    return state
  }

  /** Moves an edited shared copy to the backups and writes this release's. */
  async replace(name: string): Promise<void> {
    const path = this.copyPath(name)
    if (existsSync(path)) {
      await mkdir(this.deps.backupRoot, { recursive: true })
      const stamp = new Date(this.deps.now?.() ?? Date.now()).toISOString().replace(/[:.]/g, '-')
      await rename(path, join(this.deps.backupRoot, `${name}-${stamp}`))
    }
    await this.ensureCopy(name)
  }

  /** Brings every workspace of the project in line with its settings: links where on, none where off. */
  async syncProject(project: Project, workspaces: Workspace[]): Promise<void> {
    for (const skill of this.skills) {
      const on = project.bundledSkills?.[skill.name] ?? []
      if (on.length > 0) await this.ensureCopy(skill.name)
      for (const workspace of workspaces) {
        if (!existsSync(workspace.path)) continue
        for (const agent of SKILL_AGENTS) {
          if (on.includes(agent.agent)) await this.link(skill.name, workspace.path, agent.folder)
          else await this.unlink(skill.name, workspace.path, agent.folder)
        }
        if (on.length > 0 && project.kind === 'git') await this.exclude(workspace.path, skill.name)
      }
    }
  }

  async describe(project: Project, workspaces: Workspace[]): Promise<BundledSkill[]> {
    const out: BundledSkill[] = []
    for (const skill of this.skills) {
      const on = project.bundledSkills?.[skill.name] ?? []
      const agents = []
      for (const agent of SKILL_AGENTS) {
        let blocked = 0
        for (const workspace of workspaces) {
          if ((await this.linkState(skill.name, workspace.path, agent.folder)) === 'blocked') blocked++
        }
        agents.push({ agent: agent.agent, label: agent.label, enabled: on.includes(agent.agent), blocked })
      }
      out.push({
        name: skill.name,
        description: skill.description,
        copyPath: this.copyPath(skill.name),
        copyState: await this.copyState(skill.name),
        agents
      })
    }
    return out
  }

  /** What is at `<workspace>/<agent folder>/<name>`: our link (or an unedited copy), nothing, or something else. */
  private async linkState(name: string, workspacePath: string, folder: string[]): Promise<LinkState> {
    const path = join(workspacePath, ...folder, name)
    const info = await lstat(path).catch(() => null)
    if (!info) return 'absent'
    if (info.isSymbolicLink()) {
      const target = await realpath(path).catch(async () => resolve(dirname(path), await readlink(path).catch(() => '')))
      const ours = await realpath(this.copyPath(name)).catch(() => resolve(this.copyPath(name)))
      return samePath(target, ours) ? 'linked' : 'blocked'
    }
    // A copy (where links could not be made) is ours while it holds a version Zomfy shipped.
    const text = await readFile(join(path, 'SKILL.md'), 'utf8').catch(() => null)
    return text !== null && this.skill(name).shipped.includes(skillDigest(text)) ? 'linked' : 'blocked'
  }

  private async link(name: string, workspacePath: string, folder: string[]): Promise<void> {
    if ((await this.linkState(name, workspacePath, folder)) !== 'absent') return
    const path = join(workspacePath, ...folder, name)
    const target = this.copyPath(name)
    await mkdir(dirname(path), { recursive: true })
    try {
      // A junction needs no developer mode on Windows; elsewhere a relative link survives moving the home.
      if (process.platform === 'win32') await symlink(resolve(target), path, 'junction')
      else await symlink(relative(dirname(path), target), path, 'dir')
    } catch (error) {
      log(`linking ${name} into ${path} failed, copying instead: ${String(error)}`)
      await cp(target, path, { recursive: true })
    }
  }

  private async unlink(name: string, workspacePath: string, folder: string[]): Promise<void> {
    if ((await this.linkState(name, workspacePath, folder)) !== 'linked') return
    const path = join(workspacePath, ...folder, name)
    const info = await lstat(path)
    // A link goes as a link: its target, the shared copy, stays.
    if (info.isSymbolicLink()) await unlink(path).catch(() => rm(path, { force: true }))
    else await rm(path, { recursive: true, force: true })
  }

  /** Keeps the links out of `git status`, so a worktree with them still counts as clean. */
  private async exclude(workspacePath: string, name: string): Promise<void> {
    const common = await git(workspacePath, ['rev-parse', '--path-format=absolute', '--git-common-dir'], { quiet: true }).catch(() => null)
    if (!common) return
    const file = join(common, 'info', 'exclude')
    const current = await readFile(file, 'utf8').catch(() => '')
    const lines = SKILL_AGENTS.map((a) => `/${[...a.folder, name].join('/')}`).filter((line) => !current.split(/\r?\n/).includes(line))
    if (lines.length === 0) return
    await mkdir(dirname(file), { recursive: true })
    const prefix = current && !current.endsWith('\n') ? '\n' : ''
    await appendFile(file, `${prefix}# Zomfy's bundled skills\n${lines.join('\n')}\n`)
  }
}

/** Links and copies of skills in a workspace's agent folders, removed before the workspace is deleted. */
export async function unlinkSkillLinks(workspacePath: string): Promise<void> {
  for (const agent of SKILL_AGENTS) {
    const dir = join(workspacePath, ...agent.folder)
    for (const skill of BUNDLED_SKILLS) {
      const path = join(dir, skill.name)
      const info = await lstat(path).catch(() => null)
      if (info?.isSymbolicLink()) await unlink(path).catch(() => undefined)
    }
  }
}

function samePath(a: string, b: string): boolean {
  const norm = (p: string) => resolve(p).replace(/^\\\\\?\\/, '').replace(/[\\/]+$/, '')
  return process.platform === 'win32' ? norm(a).toLowerCase() === norm(b).toLowerCase() : norm(a) === norm(b)
}
