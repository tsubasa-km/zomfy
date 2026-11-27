import { existsSync, readFileSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import type { LspServerHint, LspServerRole, LspServerStatus, LspSetServerParams } from '@zomfy/protocol'
import { HARNESS_HOME } from './harness-home.ts'
import { hostPath } from './tui-agent-detection.ts'
import { log } from './log.ts'
import { spawnEnvironment } from './user-environment.ts'

// Which language servers Zomfy knows, as data: what each is called on a host, the languages it
// serves and what marks a project of its kind. Nothing is ever installed; a server that is not on
// the host's PATH (or in the workspace's own tool folders) is reported with the command that would
// put it there. `language-servers.json` in the harness home holds the person's own commands.

interface Candidate {
  command: string
  args: string[]
  /** `workspace` only counts a copy inside the workspace (its `node_modules/.bin`, its virtualenv). */
  where?: 'workspace'
  /** Run first; the candidate counts only when it exits 0 and its output matches. */
  probe?: { args: string[]; pattern?: RegExp }
}

export interface LspServerSpec {
  id: string
  name: string
  role: LspServerRole
  /** LSP language ids; an added server may also list editor language ids and `.ext` suffixes. */
  languages: string[]
  candidates: Candidate[]
  /** Files that mark a project root, nearest the workspace root first. */
  rootMarkers: string[]
  /** Started only when one of these exists at the root (a linter without its config only complains). */
  requires?: string[]
  install: string
  initializationOptions?: unknown
  /** Answers `workspace/configuration`, by dotted section; also sent as `workspace/didChangeConfiguration`. */
  settings?: (root: { uri: string; name: string }) => Record<string, unknown>
  /** Canned answers to requests only this server makes. */
  clientRequests?: Record<string, unknown>
}

const JS_LANGUAGES = ['typescript', 'typescriptreact', 'javascript', 'javascriptreact']
const VERSION = { args: ['--version'] }

export const LSP_SERVER_CATALOG: LspServerSpec[] = [
  {
    id: 'typescript',
    name: 'TypeScript',
    role: 'primary',
    languages: JS_LANGUAGES,
    candidates: [
      // TypeScript 7 is its own language server; a workspace on it has no tsserver for the others to drive.
      { command: 'tsc', args: ['--lsp', '--stdio'], where: 'workspace', probe: { args: ['--version'], pattern: /Version (?:[7-9]|\d{2,})\./ } },
      { command: 'typescript-language-server', args: ['--stdio'] },
      { command: 'vtsls', args: ['--stdio'] },
      { command: 'tsgo', args: ['--lsp', '--stdio'] },
      { command: 'tsc', args: ['--lsp', '--stdio'], probe: { args: ['--version'], pattern: /Version (?:[7-9]|\d{2,})\./ } }
    ],
    rootMarkers: ['tsconfig.json', 'jsconfig.json', 'package.json'],
    install: 'npm install -g typescript-language-server typescript'
  },
  {
    id: 'eslint',
    name: 'ESLint',
    role: 'linter',
    languages: JS_LANGUAGES,
    candidates: [{ command: 'vscode-eslint-language-server', args: ['--stdio'] }],
    rootMarkers: ['package.json'],
    requires: [
      'eslint.config.js',
      'eslint.config.mjs',
      'eslint.config.cjs',
      'eslint.config.ts',
      'eslint.config.mts',
      '.eslintrc',
      '.eslintrc.js',
      '.eslintrc.cjs',
      '.eslintrc.json',
      '.eslintrc.yml',
      '.eslintrc.yaml'
    ],
    install: 'npm install -g vscode-langservers-extracted',
    // The settings the ESLint server expects from VS Code's extension, at that extension's defaults.
    settings: (root) => ({
      validate: 'on',
      packageManager: null,
      useESLintClass: false,
      experimental: { useFlatConfig: false },
      codeActionOnSave: { enable: false, mode: 'all' },
      format: false,
      quiet: false,
      onIgnoredFiles: 'off',
      options: {},
      rulesCustomizations: [],
      run: 'onType',
      problems: { shortenToSingleLine: false },
      nodePath: null,
      workingDirectory: { mode: 'location' },
      workspaceFolder: root,
      codeAction: { disableRuleComment: { enable: true, location: 'separateLine' }, showDocumentation: { enable: true } }
    }),
    // 4 approves running the workspace's ESLint; the rest are notices the editor has no surface for.
    clientRequests: { 'eslint/confirmESLintExecution': 4, 'eslint/noLibrary': {}, 'eslint/noConfig': {}, 'eslint/probeFailed': {}, 'eslint/openDoc': {} }
  },
  {
    id: 'python',
    name: 'Pyright',
    role: 'primary',
    languages: ['python'],
    candidates: [
      { command: 'basedpyright-langserver', args: ['--stdio'] },
      { command: 'pyright-langserver', args: ['--stdio'] }
    ],
    rootMarkers: ['pyproject.toml', 'pyrightconfig.json', 'setup.py', 'setup.cfg', 'requirements.txt'],
    install: 'pip install basedpyright   (or: npm install -g pyright)'
  },
  {
    id: 'ruff',
    name: 'Ruff',
    role: 'linter',
    languages: ['python'],
    candidates: [{ command: 'ruff', args: ['server'], probe: VERSION }],
    rootMarkers: ['pyproject.toml', 'ruff.toml', '.ruff.toml'],
    install: 'pip install ruff'
  },
  {
    id: 'rust',
    name: 'rust-analyzer',
    role: 'primary',
    languages: ['rust'],
    // rustup leaves a `rust-analyzer` on PATH that only fails until the component is added.
    candidates: [{ command: 'rust-analyzer', args: [], probe: VERSION }],
    rootMarkers: ['Cargo.toml', 'rust-project.json'],
    install: 'rustup component add rust-analyzer'
  },
  {
    id: 'go',
    name: 'gopls',
    role: 'primary',
    languages: ['go', 'gomod', 'gowork'],
    candidates: [{ command: 'gopls', args: [] }],
    rootMarkers: ['go.work', 'go.mod'],
    install: 'go install golang.org/x/tools/gopls@latest'
  },
  {
    id: 'clangd',
    name: 'clangd',
    role: 'primary',
    languages: ['c', 'cpp', 'objective-c', 'objective-cpp'],
    candidates: [{ command: 'clangd', args: [] }],
    rootMarkers: ['compile_commands.json', 'compile_flags.txt', '.clangd', 'CMakeLists.txt'],
    install: 'install clangd (it ships with LLVM: apt install clangd, brew install llvm, winget install LLVM.LLVM)'
  }
]

const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  ts: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  tsx: 'typescriptreact',
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  jsx: 'javascriptreact',
  py: 'python',
  pyi: 'python',
  rs: 'rust',
  go: 'go',
  c: 'c',
  h: 'c',
  cc: 'cpp',
  cpp: 'cpp',
  cxx: 'cpp',
  hh: 'cpp',
  hpp: 'cpp',
  hxx: 'cpp',
  m: 'objective-c',
  mm: 'objective-cpp'
}

/** The LSP language id of a file: by its name where the host knows it, else the editor's own id. */
export function lspLanguageId(path: string, editorLanguageId: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1)
  if (name === 'go.mod') return 'gomod'
  if (name === 'go.work') return 'gowork'
  const ext = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : ''
  return LANGUAGE_BY_EXTENSION[ext] ?? editorLanguageId
}

// ── The person's own commands ────────────────────────────────────────────

interface ServerOverride {
  command?: string | null
  /** For added servers. */
  languages?: string[]
  name?: string
  disabled?: boolean
  /** Hand-edited: passed to the server at `initialize` and for `workspace/configuration`. */
  initializationOptions?: unknown
  settings?: Record<string, unknown>
}

type OverrideStore = Record<string, ServerOverride>

const STORE_PATH = join(HARNESS_HOME, 'language-servers.json')
let loaded: Promise<OverrideStore> | null = null

function loadOverrides(): Promise<OverrideStore> {
  loaded ??= readFile(STORE_PATH, 'utf8')
    .then((text): OverrideStore => JSON.parse(text))
    .catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') log(`language-servers.json unreadable: ${error.message}`)
      return {}
    })
  return loaded
}

export async function setLspServer(params: LspSetServerParams): Promise<void> {
  const store = await loadOverrides()
  const id = params.id.trim()
  if (!id) throw new Error('A language server needs a name')
  const builtin = LSP_SERVER_CATALOG.some((s) => s.id === id)
  if (params.remove) delete store[id]
  else {
    const next: ServerOverride = { ...store[id] }
    if (params.command !== undefined) next.command = params.command?.trim() || null
    if (params.disabled !== undefined) next.disabled = params.disabled
    if (params.languages !== undefined && !builtin) next.languages = params.languages.map((l) => l.trim()).filter(Boolean)
    if (!builtin && !next.command) throw new Error(`${id} needs the command that starts it`)
    if (!builtin && !next.languages?.length) throw new Error(`${id} needs the languages it serves`)
    store[id] = next
  }
  await mkdir(HARNESS_HOME, { recursive: true })
  await writeFile(STORE_PATH, JSON.stringify(store, null, 2))
  probeCache.clear()
}

// ── Finding a server on this host ────────────────────────────────────────

export type ResolvedLspServer =
  | { status: 'ready'; argv: string[]; display: string }
  | { status: 'missing'; detail: string }

export interface ServingServer {
  spec: LspServerSpec
  override: ServerOverride
}

/** The enabled servers that serve a language. A server the person added takes the main role from the built-in one. */
export async function lspServersFor(languageId: string, editorLanguageId: string, path: string): Promise<ServingServer[]> {
  const store = await loadOverrides()
  const serves = (languages: string[]) =>
    languages.some((l) => l === languageId || l === editorLanguageId || (l.startsWith('.') && path.toLowerCase().endsWith(l.toLowerCase())))
  const added = addedSpecs(store).filter((spec) => !store[spec.id]?.disabled && serves(spec.languages))
  const builtin = LSP_SERVER_CATALOG.filter(
    (spec) => !store[spec.id]?.disabled && serves(spec.languages) && !(spec.role === 'primary' && added.length > 0)
  )
  return [...added, ...builtin].map((spec) => ({ spec, override: store[spec.id] ?? {} }))
}

function addedSpecs(store: OverrideStore): LspServerSpec[] {
  return Object.entries(store)
    .filter(([id, entry]) => !LSP_SERVER_CATALOG.some((s) => s.id === id) && entry.command && entry.languages?.length)
    .map(([id, entry]) => ({
      id,
      name: entry.name ?? id,
      role: 'primary',
      languages: entry.languages ?? [],
      candidates: [],
      rootMarkers: [],
      install: ''
    }))
}

/**
 * Tool folders inside a workspace, searched before PATH: the file's own package first, then each
 * folder above it up to the workspace (a monorepo keeps its tools beside the package that uses them).
 */
function workspaceBinDirs(root: string, relativePath = ''): string[] {
  const parts = relativePath.split('/').slice(0, -1)
  const folders: string[] = []
  for (; parts.length > 0; parts.pop()) folders.push(join(root, ...parts))
  folders.push(root)
  return folders.flatMap((folder) =>
    ['node_modules/.bin', '.venv/bin', '.venv/Scripts', 'venv/bin', 'venv/Scripts'].map((dir) => join(folder, dir)).filter((dir) => existsSync(dir))
  )
}

/** Where language toolchains put binaries that a GUI-launched daemon's PATH often lacks. */
function toolchainDirs(): string[] {
  const home = homedir()
  const go = process.env.GOPATH?.split(delimiter)[0]
  return [join(home, '.cargo', 'bin'), join(go || join(home, 'go'), 'bin'), join(home, '.local', 'bin')].filter((dir) => existsSync(dir))
}

/** How this host would start the server right now, for a file (workspace-relative) of the workspace at `root`. */
export async function resolveLspServer({ spec, override }: ServingServer, root: string, relativePath = ''): Promise<ResolvedLspServer> {
  const workspace = workspaceBinDirs(root, relativePath).join(delimiter)
  const anywhere = [workspace, await hostPath(), ...toolchainDirs()].filter(Boolean).join(delimiter)
  if (override.command) {
    const [program = '', ...args] = splitCommand(override.command)
    const found = Bun.which(program, { PATH: anywhere, cwd: root })
    if (!found) return { status: 'missing', detail: `\`${program}\` (your command for ${spec.name}) is not on this host's PATH` }
    return { status: 'ready', argv: [...(await resolveShim(found, anywhere)), ...args], display: override.command }
  }
  let detail = spec.candidates.length ? `\`${spec.candidates.find((c) => !c.where)?.command ?? spec.candidates[0]!.command}\` is not on this host's PATH` : 'No command is set'
  for (const candidate of spec.candidates) {
    const found = Bun.which(candidate.command, { PATH: candidate.where === 'workspace' ? workspace : anywhere })
    if (!found) continue
    const base = await resolveShim(found, anywhere)
    if (candidate.probe) {
      const probe = await runProbe([...base, ...candidate.probe.args], root)
      if (probe.code !== 0 || (candidate.probe.pattern && !candidate.probe.pattern.test(probe.output))) {
        // A workspace-only candidate that does not fit (an older tsc) is no finding at all.
        if (!candidate.where) detail = `\`${candidate.command}\` is on PATH but does not run: ${probe.output.trim().split('\n')[0]?.slice(0, 200) || `exit ${probe.code}`}`
        continue
      }
    }
    return { status: 'ready', argv: [...base, ...candidate.args], display: [found, ...candidate.args].join(' ') }
  }
  return { status: 'missing', detail }
}

export function lspServerHint(spec: LspServerSpec): LspServerHint {
  return { serverId: spec.id, name: spec.name, command: spec.candidates.find((c) => !c.where)?.command ?? spec.id, install: spec.install }
}

/** Every known and added server with what this host would run for it, for settings. */
export async function listLspServers(root: string | null): Promise<LspServerStatus[]> {
  const store = await loadOverrides()
  const all = [...LSP_SERVER_CATALOG, ...addedSpecs(store)]
  return Promise.all(
    all.map(async (spec): Promise<LspServerStatus> => {
      const override = store[spec.id] ?? {}
      const resolved = await resolveLspServer({ spec, override }, root ?? homedir())
      const builtin = LSP_SERVER_CATALOG.includes(spec)
      return {
        id: spec.id,
        name: spec.name,
        role: spec.role,
        languages: spec.languages,
        builtin,
        command: override.command ?? null,
        disabled: override.disabled === true,
        resolved: resolved.status === 'ready' ? resolved.display : null,
        detail: resolved.status === 'missing' ? resolved.detail : null,
        install: builtin ? spec.install : null
      }
    })
  )
}

/** The folder a server is started in: the workspace when it is a project of the server's kind, else the nearest such folder above the file. */
export function lspProjectRoot(spec: LspServerSpec, workspaceRoot: string, relativePath: string): string {
  const marked = (dir: string) => spec.rootMarkers.some((marker) => existsSync(join(dir, marker)))
  if (marked(workspaceRoot)) return workspaceRoot
  const parts = relativePath.split('/').slice(0, -1)
  while (parts.length > 0) {
    const dir = join(workspaceRoot, ...parts)
    if (marked(dir)) return dir
    parts.pop()
  }
  return workspaceRoot
}

export function lspRequirementMet(spec: LspServerSpec, root: string): boolean {
  if (!spec.requires) return true
  if (spec.requires.some((file) => existsSync(join(root, file)))) return true
  // ESLint's config may also live in package.json.
  if (spec.id !== 'eslint') return false
  try {
    return 'eslintConfig' in JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  } catch {
    return false
  }
}

const PROBE_TIMEOUT_MS = 8_000
/** A probe that failed is tried again after this long: the person may have installed the server meanwhile. */
const FAILED_PROBE_TTL_MS = 60_000
const probeCache = new Map<string, Promise<{ code: number; output: string; at: number }>>()

/** Forgets what earlier probes found, so a server installed since is seen. */
export function refreshLspServerProbes(): void {
  probeCache.clear()
}

async function runProbe(argv: string[], cwd: string): Promise<{ code: number; output: string }> {
  const key = argv.join('\0')
  let pending = probeCache.get(key)
  const stale = await pending?.then((probe) => probe.code !== 0 && Date.now() - probe.at > FAILED_PROBE_TTL_MS)
  if (!pending || stale) {
    pending = (async () => {
      const proc = Bun.spawn(argv, { cwd, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe', env: await spawnEnvironment(), windowsHide: true })
      const timer = setTimeout(() => proc.kill(), PROBE_TIMEOUT_MS)
      const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited])
      clearTimeout(timer)
      return { code, output: `${out}\n${err}`, at: Date.now() }
    })().catch((error: unknown) => ({ code: -1, output: String(error), at: Date.now() }))
    probeCache.set(key, pending)
  }
  return pending
}

/** npm's Windows `.cmd` shims run their target through cmd.exe, which a kill leaves running; start the target itself. */
async function resolveShim(path: string, PATH: string): Promise<string[]> {
  if (process.platform !== 'win32' || !/\.cmd$/i.test(path)) return [path]
  try {
    const text = await readFile(path, 'utf8')
    const target = [...text.matchAll(/"%dp0%\\([^"]+)"/g)].map((m) => m[1]!).at(-1)
    if (!target) return [path]
    const full = join(dirname(path), target)
    if (/\.exe$/i.test(full)) return [full]
    if (/\.[cm]?js$/i.test(full) || !/\.[a-z0-9]+$/i.test(full)) return [Bun.which('node', { PATH }) ?? 'node', full]
  } catch (error) {
    log(`reading shim ${path} failed: ${String(error)}`)
  }
  return [path]
}

/** A settings command line: whitespace-separated, with double quotes around parts that hold spaces. */
export function splitCommand(line: string): string[] {
  return [...line.matchAll(/"([^"]*)"|(\S+)/g)].map((m) => m[1] ?? m[2]!)
}
