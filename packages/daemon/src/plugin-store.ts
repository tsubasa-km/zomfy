import { createHash } from 'node:crypto'
import type { Dirent } from 'node:fs'
import { mkdir, readdir, readFile, realpath, rename, stat, writeFile } from 'node:fs/promises'
import { isAbsolute, join, relative, sep } from 'node:path'
import {
  PLUGIN_CAPABILITY_KINDS,
  type PluginCommandContribution,
  type PluginKeybindingContribution,
  PLUGIN_MANIFEST_FILENAME,
  type PluginCapabilityKind,
  type PluginListEntry,
  type PluginManifest,
  type PluginsSnapshot
} from '@acp-harness/protocol'
import { HARNESS_HOME } from './harness-home.ts'

// Orca's plugin discovery and enablement (main/plugins/plugin-discovery.ts, plugin-enablement.ts,
// shared/plugins/plugin-manifest.ts) for plugins the user put in this computer's harness home.
// Enabling records the consent fingerprint the user reviewed, so a changed manifest asks again.

const PLUGINS_DIR = join(HARNESS_HOME, 'plugins')
const STATE_FILE = join(HARNESS_HOME, 'plugin-state.json')
const MAX_MANIFEST_BYTES = 256 * 1024
const MAX_PANEL_BYTES = 2 * 1024 * 1024

const ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const COMMAND_ID_RE = /^[A-Za-z0-9]+(?:[._-][A-Za-z0-9]+)*$/
const SEMVER_RE = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/
// Orca's plugin-path-safety.ts: portable relative paths that stay inside the plugin folder.
const WINDOWS_DEVICE_RE = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i

function safeRelativePath(value: unknown): value is string {
  if (typeof value !== 'string' || !value || value.length > 1024 || value.startsWith('/') || value.startsWith('\\')) return false
  return value.split(/[\\/]/).every(
    (s) => s && s !== '.' && s !== '..' && !/[<>:"|?*\u0000-\u001f]/.test(s) && !/[. ]$/.test(s) && !WINDOWS_DEVICE_RE.test(s)
  )
}

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const text = (v: unknown, max: number): v is string => typeof v === 'string' && v.length > 0 && v.length <= max

function list(raw: Record<string, unknown>, key: string, limit: number): unknown[] {
  const value = raw[key]
  if (value === undefined) return []
  if (!Array.isArray(value)) throw new Error(`contributes.${key} must be an array`)
  if (value.length > limit) throw new Error(`contributes.${key} allows at most ${limit} entries`)
  return value
}

/** Validates the manifest fields the harness reads; others Orca knows are tolerated and ignored. */
export function parsePluginManifest(raw: unknown): PluginManifest {
  if (!isRecord(raw)) throw new Error('manifest must be a JSON object')
  if (raw.manifestVersion !== 1) throw new Error('manifestVersion must be 1')
  for (const key of ['id', 'publisher'] as const) {
    if (!text(raw[key], 64) || !ID_RE.test(raw[key])) throw new Error(`${key} must be kebab-case`)
  }
  if (!text(raw.name, 256)) throw new Error('name is required')
  if (typeof raw.version !== 'string' || !SEMVER_RE.test(raw.version)) throw new Error('version must be semver')
  if (raw.main !== undefined && !safeRelativePath(raw.main)) throw new Error('main must be a relative path inside the plugin')
  const contributes = raw.contributes === undefined ? {} : raw.contributes
  if (!isRecord(contributes)) throw new Error('contributes must be an object')

  const panels = list(contributes, 'panels', 64).map((p, i) => {
    if (!isRecord(p) || !text(p.id, 64) || !ID_RE.test(p.id) || !text(p.title, 256)) throw new Error(`contributes.panels.${i} needs a kebab-case id and a title`)
    if (!safeRelativePath(p.entry)) throw new Error(`contributes.panels.${i}.entry must be a relative path inside the plugin`)
    return { id: p.id, title: p.title, entry: p.entry, ...(text(p.icon, 64) ? { icon: p.icon } : {}) }
  })
  const commands = list(contributes, 'commands', 256).map((c, i): PluginCommandContribution => {
    if (!isRecord(c) || !text(c.id, 256) || !COMMAND_ID_RE.test(c.id) || !text(c.title, 256)) throw new Error(`contributes.commands.${i} needs an id and a title`)
    if (c.action !== undefined && (!text(c.action, 256) || !COMMAND_ID_RE.test(c.action))) throw new Error(`contributes.commands.${i}.action is not a command id`)
    const context = c.context === 'worktree' || c.context === 'global' ? c.context : undefined
    return { id: c.id, title: c.title, ...(context ? { context } : {}), ...(typeof c.action === 'string' ? { action: c.action } : {}) }
  })
  const keybindings = list(contributes, 'keybindings', 64).map((k, i): PluginKeybindingContribution => {
    if (!isRecord(k) || !text(k.command, 256) || !text(k.key, 128)) throw new Error(`contributes.keybindings.${i} needs a command and a key`)
    if (!commands.some((c) => c.id === k.command)) throw new Error(`contributes.keybindings.${i} names an unknown command`)
    const when = k.when === 'worktree' || k.when === 'global' ? k.when : undefined
    return { command: k.command, key: k.key, ...(when ? { when } : {}) }
  })
  for (const [label, ids] of [['panel', panels.map((p) => p.id)], ['command', commands.map((c) => c.id)]] as const) {
    if (new Set(ids).size !== ids.length) throw new Error(`duplicate ${label} id`)
  }
  const capabilities = (Array.isArray(raw.capabilities) ? raw.capabilities : []).map((c, i) => {
    const kind = isRecord(c) ? c.kind : undefined
    // A typo (or a newer Orca's capability) fails instead of silently granting nothing.
    if (!PLUGIN_CAPABILITY_KINDS.includes(kind as PluginCapabilityKind)) throw new Error(`capabilities.${i} is not a known capability`)
    return { kind: kind as PluginCapabilityKind }
  })
  const author = isRecord(raw.author) && text(raw.author.name, 256) ? { name: raw.author.name, ...(text(raw.author.url, 2048) ? { url: raw.author.url } : {}) } : undefined
  return {
    manifestVersion: 1,
    id: raw.id as string,
    publisher: raw.publisher as string,
    name: raw.name,
    version: raw.version,
    ...(text(raw.description, 4096) ? { description: raw.description } : {}),
    ...(author ? { author } : {}),
    ...(text(raw.repository, 2048) ? { repository: raw.repository } : {}),
    ...(typeof raw.main === 'string' ? { main: raw.main } : {}),
    contributes: { panels, commands, keybindings },
    capabilities
  }
}

/** Covers what the user agreed to: capabilities and every contribution that reaches the app. */
export function consentFingerprint(manifest: PluginManifest): string {
  const canonical = JSON.stringify({
    capabilities: [...new Set(manifest.capabilities.map((c) => c.kind))].sort(),
    panels: manifest.contributes.panels.map((p) => [p.id, p.entry]),
    commands: manifest.contributes.commands.map((c) => [c.id, c.action ?? null]),
    keybindings: manifest.contributes.keybindings.map((k) => [k.command, k.key, k.when ?? null]),
    main: manifest.main ?? null
  })
  return createHash('sha256').update(canonical).digest('hex').slice(0, 32)
}

function inside(root: string, child: string): boolean {
  const rel = relative(root, child)
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))
}

export class PluginStore {
  private consent: Promise<Record<string, string>> | null = null
  private writes: Promise<unknown> = Promise.resolve()
  private last: PluginListEntry[] = []

  private readConsent(): Promise<Record<string, string>> {
    this.consent ??= readFile(STATE_FILE, 'utf8')
      .then((t) => {
        const parsed: unknown = JSON.parse(t)
        const enabled = isRecord(parsed) && isRecord(parsed.enabled) ? parsed.enabled : {}
        return Object.fromEntries(Object.entries(enabled).filter((e): e is [string, string] => typeof e[1] === 'string'))
      })
      .catch(() => ({}))
    return this.consent
  }

  async list(): Promise<PluginsSnapshot> {
    await mkdir(PLUGINS_DIR, { recursive: true })
    const consent = await this.readConsent()
    let entries: Dirent[] = []
    try {
      entries = await readdir(PLUGINS_DIR, { withFileTypes: true })
    } catch {}
    const plugins: PluginListEntry[] = []
    const seen = new Set<string>()
    for (const entry of entries.filter((e) => e.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
      const rootDir = join(PLUGINS_DIR, entry.name)
      try {
        const manifestPath = join(rootDir, PLUGIN_MANIFEST_FILENAME)
        const info = await stat(manifestPath).catch(() => null)
        if (!info?.isFile()) throw new Error(`missing ${PLUGIN_MANIFEST_FILENAME}`)
        if (info.size > MAX_MANIFEST_BYTES) throw new Error(`${PLUGIN_MANIFEST_FILENAME} is larger than 256 KB`)
        let raw: unknown
        try {
          raw = JSON.parse(await readFile(manifestPath, 'utf8'))
        } catch (error) {
          throw new Error(`invalid JSON in ${PLUGIN_MANIFEST_FILENAME}: ${error instanceof Error ? error.message : String(error)}`)
        }
        const manifest = parsePluginManifest(raw)
        const pluginKey = `${manifest.publisher}.${manifest.id}`
        if (seen.has(pluginKey)) throw new Error(`another folder already provides ${pluginKey}`)
        seen.add(pluginKey)
        const fingerprint = consentFingerprint(manifest)
        const granted = consent[pluginKey]
        plugins.push({
          pluginKey,
          rootDir,
          manifest,
          consentFingerprint: fingerprint,
          status: granted === undefined ? 'disabled' : granted === fingerprint ? 'enabled' : 'needs-review'
        })
      } catch (error) {
        plugins.push({ pluginKey: entry.name, rootDir, status: 'invalid', error: error instanceof Error ? error.message : String(error) })
      }
    }
    this.last = plugins
    return { pluginsDir: PLUGINS_DIR, plugins }
  }

  async setEnabled(pluginKey: string, enabled: boolean, fingerprint?: string): Promise<PluginsSnapshot> {
    const plugin = (await this.list()).plugins.find((p) => p.pluginKey === pluginKey)
    if (!plugin || plugin.status === 'invalid') throw new Error(`No valid plugin ${pluginKey}`)
    const consent = { ...(await this.readConsent()) }
    if (enabled) {
      if (!fingerprint || fingerprint !== plugin.consentFingerprint) throw new Error('The plugin changed since you reviewed it; review it again')
      consent[pluginKey] = fingerprint
    } else {
      delete consent[pluginKey]
    }
    this.consent = Promise.resolve(consent)
    this.writes = this.writes.then(async () => {
      await mkdir(HARNESS_HOME, { recursive: true })
      await writeFile(`${STATE_FILE}.tmp`, JSON.stringify({ enabled: consent }, null, 2))
      await rename(`${STATE_FILE}.tmp`, STATE_FILE)
    })
    await this.writes
    return this.list()
  }

  /** An enabled plugin's panel HTML; symlinks may not lead outside the plugin folder. */
  async readPanel(pluginKey: string, panelId: string): Promise<string> {
    const plugin = (this.last.find((p) => p.pluginKey === pluginKey) ? this.last : (await this.list()).plugins).find((p) => p.pluginKey === pluginKey)
    if (!plugin?.manifest || plugin.status !== 'enabled') throw new Error(`${pluginKey} is not enabled`)
    const panel = plugin.manifest.contributes.panels.find((p) => p.id === panelId)
    if (!panel) throw new Error(`${pluginKey} has no panel ${panelId}`)
    const root = await realpath(plugin.rootDir)
    const file = await realpath(join(plugin.rootDir, panel.entry))
    if (!inside(root, file)) throw new Error('Panel entry leaves the plugin folder')
    const info = await stat(file)
    if (!info.isFile() || info.size > MAX_PANEL_BYTES) throw new Error('Panel entry must be a file under 2 MB')
    return readFile(file, 'utf8')
  }
}
