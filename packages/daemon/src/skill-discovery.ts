import { createHash } from 'node:crypto'
import type { Dirent } from 'node:fs'
import { open, readdir, readFile, realpath, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, sep } from 'node:path'
import type {
  DiscoveredSkill,
  Project,
  SkillDiscoveryResult,
  SkillDiscoverySource,
  SkillProvider,
  SkillSourceKind
} from '@acp-harness/protocol'

// Port of Orca's skill discovery (main/skills/discovery.ts, skill-discovery-sources.ts,
// skill-root-file-walk.ts, claude-plugin-skill-sources.ts, shared/skill-metadata.ts). Runs on the
// daemon's host, so a WSL or SSH daemon scans that machine's homes and projects.

const SKILL_FILE_NAME = 'SKILL.md'
const MAX_MARKDOWN_BYTES = 256 * 1024
const MAX_PLUGIN_METADATA_BYTES = 4 * 1024 * 1024
// Orca's shared/skill-discovery-depth.ts: the SKILL.md may sit this deep below its root.
const SKILL_FILE_MAX_DEPTH = 5
const PLUGIN_SKILL_FILE_MAX_DEPTH = 10

type ScanRoot = Omit<SkillDiscoverySource, 'exists'>

/** Orca's SKILL_INSTALL_PROVIDERS entries that keep their own skill folders. */
const PROVIDERS: { id: string; name: string; global: string[] | null; workspace: string[] | null; homeEnv?: string }[] = [
  { id: 'claude', name: 'Claude Code', global: ['.claude', 'skills'], workspace: ['.claude', 'skills'], homeEnv: 'CLAUDE_CONFIG_DIR' },
  { id: 'cursor', name: 'Cursor', global: ['.cursor', 'skills'], workspace: null },
  { id: 'gemini', name: 'Gemini CLI', global: ['.gemini', 'skills'], workspace: null },
  { id: 'droid', name: 'Droid', global: ['.factory', 'skills'], workspace: ['.factory', 'skills'] },
  { id: 'continue', name: 'Continue', global: ['.continue', 'skills'], workspace: ['.continue', 'skills'] },
  { id: 'trae', name: 'Trae', global: ['.trae-cn', 'skills'], workspace: ['.trae', 'skills'] },
  { id: 'grok', name: 'Grok', global: ['.grok', 'skills'], workspace: ['.grok', 'skills'], homeEnv: 'GROK_HOME' },
  { id: 'aug', name: 'Augment', global: ['.augment', 'skills'], workspace: ['.augment', 'skills'] },
  { id: 'zcode', name: 'ZCode', global: ['.zcode', 'skills'], workspace: null },
  { id: 'codebuddy', name: 'CodeBuddy', global: ['.codebuddy', 'skills'], workspace: ['.codebuddy', 'skills'] },
  { id: 'qoder', name: 'Qoder', global: ['.qoder', 'skills'], workspace: ['.qoder', 'skills'] },
  { id: 'kiro', name: 'Kiro', global: ['.kiro', 'skills'], workspace: ['.kiro', 'skills'], homeEnv: 'KIRO_HOME' },
  { id: 'antigravity', name: 'Antigravity', global: ['.gemini', 'config', 'skills'], workspace: null }
]

function stablePathId(path: string): string {
  return createHash('sha1').update(path).digest('hex').slice(0, 16)
}

// Claude has its own provider tag; every other agent shares agent-skills.
function providersFor(id: string): SkillProvider[] {
  return id === 'claude' ? ['claude'] : ['agent-skills']
}

function root(id: string, label: string, path: string, sourceKind: SkillSourceKind, providers: SkillProvider[], owner: string | null): ScanRoot {
  return { id, label, path, sourceKind, providers, owner }
}

function homeRoots(home: string): ScanRoot[] {
  const env = (name: string | undefined) => (name ? process.env[name]?.trim() : undefined)
  return [
    root('home-codex', 'Codex home', join(home, '.codex', 'skills'), 'home', ['codex'], 'codex'),
    root('home-agents', 'Agent skills home', join(home, '.agents', 'skills'), 'home', ['agent-skills'], null),
    root('codex-plugin-cache', 'Codex plugin cache', join(home, '.codex', 'plugins', 'cache'), 'plugin', ['codex', 'agent-skills'], 'codex'),
    ...PROVIDERS.filter((p) => p.global).map((p) => {
      // An env-relocated agent home keeps its skills in `<home>/skills`.
      const relocated = env(p.homeEnv)
      return root(`home-${p.id}`, `${p.name} home`, relocated ? join(relocated, 'skills') : join(home, ...p.global!), 'home', providersFor(p.id), p.id)
    }),
    root('home-opencode', 'OpenCode home', join(home, '.config', 'opencode', 'skills'), 'home', ['agent-skills'], 'opencode'),
    root('home-pi', 'Pi home', join(home, '.pi', 'agent', 'skills'), 'home', ['agent-skills'], 'pi'),
    root('home-omp', 'OMP home', join(home, '.omp', 'agent', 'skills'), 'home', ['agent-skills'], 'omp'),
    root('home-hermes', 'Hermes home', env('HERMES_HOME') ? join(env('HERMES_HOME')!, 'skills') : join(home, '.hermes', 'skills'), 'home', ['agent-skills'], 'hermes'),
    root('home-prime-agent', 'Prime Agent home', join(home, '.prime', 'agent', 'skills'), 'home', ['agent-skills'], 'prime-agent'),
    root('home-muse', 'Muse home', join(home, '.config', 'muse', 'skills'), 'home', ['agent-skills'], 'muse')
  ]
}

function projectRoots(projectPath: string, projectName: string): ScanRoot[] {
  const label = `Repo ${projectName}`
  const key = stablePathId(projectPath)
  return [
    root(`repo-agents-${key}`, `${label} .agents`, join(projectPath, '.agents', 'skills'), 'repo', ['agent-skills'], null),
    ...PROVIDERS.filter((p) => p.workspace).map((p) =>
      root(`repo-${p.id}-${key}`, `${label} ${p.workspace![0]}`, join(projectPath, ...p.workspace!), 'repo', providersFor(p.id), p.id)
    ),
    root(`repo-opencode-${key}`, `${label} .opencode`, join(projectPath, '.opencode', 'skills'), 'repo', ['agent-skills'], 'opencode')
  ]
}

// ── Claude plugin skills: enabled plugins from installed_plugins.json + settings ──

async function readSmallFile(path: string, limit: number): Promise<string | null> {
  try {
    const info = await stat(path)
    if (!info.isFile() || info.size > limit) return null
    return await readFile(path, 'utf8')
  } catch {
    return null
  }
}

function jsonObject(text: string | null): Record<string, unknown> | null {
  if (!text) return null
  try {
    const parsed: unknown = JSON.parse(text)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

interface PluginInstall {
  scope: 'user' | 'project' | 'local'
  installPath: string
  projectPath?: string
  stamp: number
}

function parseInstall(value: unknown): PluginInstall | null {
  if (!value || typeof value !== 'object') return null
  const r = value as Record<string, unknown>
  if ((r.scope !== 'user' && r.scope !== 'project' && r.scope !== 'local') || typeof r.installPath !== 'string') return null
  const stamp = Date.parse(String(r.lastUpdated ?? r.installedAt ?? ''))
  return {
    scope: r.scope,
    installPath: r.installPath,
    ...(typeof r.projectPath === 'string' ? { projectPath: r.projectPath } : {}),
    stamp: Number.isFinite(stamp) ? stamp : 0
  }
}

function isInside(parent: string, child: string): boolean {
  const rel = relative(parent, child)
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))
}

/** Claude merges user, project, then project-local settings; a plugin is on only when enabled. */
async function claudePluginRoots(home: string, cwd: string | null): Promise<ScanRoot[]> {
  const installed = jsonObject(await readSmallFile(join(home, '.claude', 'plugins', 'installed_plugins.json'), MAX_PLUGIN_METADATA_BYTES))?.plugins
  if (!installed || typeof installed !== 'object' || Array.isArray(installed)) return []
  const settingsFiles = [join(home, '.claude', 'settings.json')]
  if (cwd) settingsFiles.push(join(cwd, '.claude', 'settings.json'), join(cwd, '.claude', 'settings.local.json'))
  const enabled = new Map<string, boolean>()
  for (const text of await Promise.all(settingsFiles.map((f) => readSmallFile(f, MAX_PLUGIN_METADATA_BYTES)))) {
    const configured = jsonObject(text)?.enabledPlugins
    if (!configured || typeof configured !== 'object' || Array.isArray(configured)) continue
    for (const [id, on] of Object.entries(configured)) if (typeof on === 'boolean') enabled.set(id, on)
  }
  const roots: ScanRoot[] = []
  for (const [pluginId, raw] of Object.entries(installed as Record<string, unknown>)) {
    if (enabled.get(pluginId) !== true || !Array.isArray(raw)) continue
    const priority = (i: PluginInstall) => (i.scope === 'local' ? 2 : i.scope === 'project' ? 1 : 0)
    const install = raw
      .map(parseInstall)
      .filter((i): i is PluginInstall => i !== null && isAbsolute(i.installPath))
      .filter((i) => i.scope === 'user' || (cwd !== null && !!i.projectPath && isAbsolute(i.projectPath) && isInside(i.projectPath, cwd)))
      .sort((a, b) => priority(b) - priority(a) || (b.projectPath?.length ?? 0) - (a.projectPath?.length ?? 0) || b.stamp - a.stamp)[0]
    if (!install) continue
    const path = join(install.installPath, 'skills')
    const label = (pluginId.split('@')[0] || basename(pluginId)).replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 80) || 'plugin'
    roots.push(root(`claude-plugin-${stablePathId(path)}`, `Claude plugin ${label}`, path, 'plugin', ['claude'], 'claude'))
  }
  return roots
}

// ── Walking a root for SKILL.md files ──

async function findSkillFiles(rootPath: string, maxDirDepth: number): Promise<string[]> {
  const out: string[] = []
  const visited = new Set<string>()
  const withinDepth = (child: string) => {
    const rel = relative(rootPath, child)
    return !rel || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel) && rel.split(sep).length <= maxDirDepth)
  }
  async function visit(dir: string): Promise<void> {
    let resolved: string
    try {
      resolved = await realpath(dir)
    } catch {
      return
    }
    // Symlinked skill dirs are common across agents; realpath stops link loops.
    if (visited.has(resolved)) return
    visited.add(resolved)
    let entries: Dirent[]
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const path = join(dir, entry.name)
      if (entry.name === SKILL_FILE_NAME) {
        if (entry.isFile() || (entry.isSymbolicLink() && (await stat(path).then((s) => s.isFile(), () => false)))) out.push(path)
        continue
      }
      if (!withinDepth(path)) continue
      if (entry.isDirectory()) await visit(path)
      else if (entry.isSymbolicLink() && (await stat(path).then((s) => s.isDirectory(), () => false))) await visit(path)
    }
  }
  await visit(rootPath)
  return out
}

// ── SKILL.md summary (Orca's shared/skill-metadata.ts) ──

function unquote(value: string): string {
  const t = value.trim()
  return (t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'")) ? t.slice(1, -1) : t
}

function frontmatterFields(raw: string): Record<string, string> {
  const lines = raw.replace(/\r\n/g, '\n').split('\n')
  const data: Record<string, string> = {}
  for (let i = 0; i < lines.length; i++) {
    const match = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(lines[i] ?? '')
    const key = match?.[1]
    if (!key) continue
    const value = (match[2] ?? '').trim()
    if (value === '|' || value === '|-' || value === '>' || value === '>-') {
      const block: string[] = []
      while (i + 1 < lines.length && /^(?:\s{2,}|\s*$)/.test(lines[i + 1] ?? '')) block.push((lines[++i] ?? '').replace(/^\s{2}/, ''))
      data[key] = block.join(value.startsWith('>') ? ' ' : '\n').replace(/\s+/g, ' ').trim()
      continue
    }
    data[key] = unquote(value)
  }
  return data
}

export function summarizeSkillMarkdown(markdown: string): { name: string | null; description: string | null } {
  const text = markdown.replace(/^﻿/, '')
  const fm = /^---\s*\n([\s\S]*?)\n---\s*(?:\n|$)/.exec(text.replace(/\r\n/g, '\n'))
  const body = fm ? text.replace(/\r\n/g, '\n').slice(fm[0].length) : text
  const fields = fm ? frontmatterFields(fm[1] ?? '') : {}
  const heading = /^#\s+(.+)$/m.exec(body)?.[1]?.trim() || null
  let paragraph: string[] = []
  for (const line of body.replace(/\r\n/g, '\n').split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#') || t.startsWith('```')) {
      if (paragraph.length) break
      continue
    }
    paragraph.push(t)
    if (paragraph.join(' ').length > 240) break
  }
  return {
    name: fields.name?.trim() || heading,
    description: fields.description?.trim() || (paragraph.length ? paragraph.join(' ') : null)
  }
}

async function readHead(path: string, limit: number): Promise<{ content: string; size: number; mtimeMs: number } | null> {
  try {
    const info = await stat(path)
    const file = await open(path, 'r')
    try {
      const buffer = Buffer.alloc(Math.min(info.size, limit))
      const { bytesRead } = await file.read(buffer, 0, buffer.length, 0)
      return { content: buffer.toString('utf8', 0, bytesRead), size: info.size, mtimeMs: info.mtimeMs }
    } finally {
      await file.close()
    }
  } catch {
    return null
  }
}

type ScannedSkill = DiscoveredSkill & { canonical: string }

async function scanRoot(scan: ScanRoot): Promise<ScannedSkill[]> {
  const depth = (scan.sourceKind === 'plugin' ? PLUGIN_SKILL_FILE_MAX_DEPTH : SKILL_FILE_MAX_DEPTH) - 1
  const files = await findSkillFiles(scan.path, depth)
  const skills = await Promise.all(
    files.map(async (skillFilePath): Promise<ScannedSkill | null> => {
      const head = await readHead(skillFilePath, MAX_MARKDOWN_BYTES)
      if (!head) return null
      const canonical = await realpath(skillFilePath).catch(() => skillFilePath)
      const summary = summarizeSkillMarkdown(head.content)
      const directoryPath = dirname(skillFilePath)
      // `~/.codex/skills/.system` holds the agent's own bundled skills.
      const bundled = scan.sourceKind === 'home' && relative(scan.path, skillFilePath).split(sep)[0] === '.system'
      return {
        id: stablePathId(canonical),
        name: summary.name ?? basename(directoryPath),
        description: summary.description,
        providers: [...scan.providers],
        sourceKind: bundled ? 'bundled' : scan.sourceKind,
        sourceLabel: bundled ? `${scan.label} bundled` : scan.label,
        rootPath: scan.path,
        directoryPath,
        skillFilePath,
        updatedAt: head.mtimeMs,
        canonical
      }
    })
  )
  return skills.filter((s): s is ScannedSkill => s !== null)
}

async function exists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false
  )
}

/** Every skill on this host: agent homes, each project's skill folders, enabled Claude plugins. */
export async function discoverSkills(projects: Pick<Project, 'path' | 'name' | 'displayName'>[]): Promise<SkillDiscoveryResult> {
  const home = homedir()
  const pluginRoots = await Promise.all([claudePluginRoots(home, null), ...projects.map((p) => claudePluginRoots(home, p.path))])
  const byPath = new Map<string, ScanRoot>()
  for (const r of [...homeRoots(home), ...projects.flatMap((p) => projectRoots(p.path, p.displayName ?? p.name)), ...pluginRoots.flat()]) {
    // Two roots can share a path (home as a project); the first scope keeps it.
    if (!byPath.has(r.path)) byPath.set(r.path, r)
  }
  const roots = [...byPath.values()]
  const scans = await Promise.all(roots.map(async (r) => ((await exists(r.path)) ? { exists: true, skills: await scanRoot(r) } : { exists: false, skills: [] })))
  const seen = new Map<string, DiscoveredSkill>()
  for (const { skills } of scans) {
    for (const { canonical, ...skill } of skills) {
      const existing = seen.get(canonical)
      if (!existing) {
        seen.set(canonical, { ...skill, rootPaths: [skill.rootPath] })
        continue
      }
      if (!existing.rootPaths?.includes(skill.rootPath)) existing.rootPaths?.push(skill.rootPath)
      existing.providers = [...new Set([...existing.providers, ...skill.providers])]
    }
  }
  const compare = new Intl.Collator(undefined, { sensitivity: 'base' }).compare
  const skills = [...seen.values()].sort(
    (a, b) => compare(a.name, b.name) || compare(a.sourceLabel, b.sourceLabel) || a.skillFilePath.localeCompare(b.skillFilePath)
  )
  const sources = roots.map((r, i) => ({ ...r, exists: scans[i]?.exists ?? false })).sort((a, b) => compare(a.label, b.label))
  return { skills, sources, scannedAt: Date.now() }
}

export async function readSkillMarkdown(path: string): Promise<{ content: string; truncated: boolean }> {
  const head = await readHead(path, MAX_MARKDOWN_BYTES)
  if (!head) throw new Error(`Could not read ${path}`)
  return { content: head.content, truncated: head.size > MAX_MARKDOWN_BYTES }
}
