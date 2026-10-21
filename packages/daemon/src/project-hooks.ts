import { existsSync } from 'node:fs'
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import type { Project, ProjectHookInfo, ProjectHooks } from '@acp-harness/protocol'
import { git } from './git-cli.ts'
import { log } from './log.ts'

// Orca's orca.yaml `scripts.setup` / `scripts.archive` (src/main/hooks.ts, worktree-runner-script.ts).
// acp-harness.yaml is read first so a repo can carry harness-specific hooks next to Orca's.

const HOOK_FILES = ['acp-harness.yaml', 'orca.yaml']
const ARCHIVE_TIMEOUT_MS = 120_000

export type HookKind = keyof ProjectHooks

export async function readHookFile(root: string): Promise<{ file: string | null; hooks: ProjectHooks }> {
  for (const name of HOOK_FILES) {
    const path = join(root, name)
    if (!existsSync(path)) continue
    try {
      const doc: unknown = Bun.YAML.parse(await readFile(path, 'utf8'))
      const scripts = isRecord(doc) && isRecord(doc.scripts) ? doc.scripts : {}
      return { file: name, hooks: { setup: text(scripts.setup), archive: text(scripts.archive) } }
    } catch (error) {
      log(`could not parse ${path}: ${String(error)}`)
      return { file: name, hooks: {} }
    }
  }
  return { file: null, hooks: {} }
}

export async function projectHookInfo(project: Project): Promise<ProjectHookInfo> {
  const { file, hooks } = await readHookFile(project.path)
  return { file, fileHooks: hooks, localHooks: project.hooks ?? {} }
}

/** The file's script, then the project's own (Orca's "run both"); read from the worktree, as Orca does. */
export async function effectiveHook(project: Project, kind: HookKind, worktreePath: string): Promise<string | null> {
  const { hooks } = await readHookFile(worktreePath)
  const parts = [hooks[kind], project.hooks?.[kind]].map((s) => s?.trim()).filter((s): s is string => !!s)
  return parts.length > 0 ? parts.join('\n') : null
}

export interface HookLaunch {
  argv: string[]
  env: Record<string, string>
}

/**
 * Writes the script to a runner under the worktree's git dir. Windows runs a .cmd unless the script
 * starts with `#!`, which opts it into Git Bash, as in Orca; other hosts always use bash.
 */
export async function writeHookRunner(
  project: Project,
  worktreePath: string,
  kind: HookKind,
  script: string
): Promise<HookLaunch> {
  const posix = process.platform !== 'win32' || script.trimStart().startsWith('#!')
  const rel = `acp-harness/${kind}-runner.${posix ? 'sh' : 'cmd'}`
  const runner = resolve(worktreePath, await git(worktreePath, ['rev-parse', '--git-path', rel]))
  await mkdir(dirname(runner), { recursive: true })
  await writeFile(runner, posix ? posixRunner(script) : windowsRunner(script))
  const env = hookEnv(project, worktreePath)
  if (!posix) return { argv: [process.env.ComSpec || 'cmd.exe', '/d', '/c', runner], env }
  if (process.platform !== 'win32') {
    await chmod(runner, 0o755)
    return { argv: [Bun.which('bash') ?? '/bin/sh', runner], env }
  }
  const bash = ['C:\\Program Files\\Git\\bin\\bash.exe', 'C:\\Program Files (x86)\\Git\\bin\\bash.exe'].find((p) =>
    existsSync(p)
  )
  if (!bash) throw new Error('This script starts with "#!" and needs Git Bash, which was not found')
  return { argv: [bash, runner.replaceAll('\\', '/')], env }
}

/** The archive hook runs unattended before a worktree is removed; a failure is logged, not fatal. */
export async function runArchiveHook(project: Project, worktreePath: string): Promise<void> {
  const script = await effectiveHook(project, 'archive', worktreePath)
  if (!script) return
  try {
    const launch = await writeHookRunner(project, worktreePath, 'archive', script)
    const proc = Bun.spawn(launch.argv, {
      cwd: worktreePath,
      env: { ...process.env, ...launch.env },
      stdout: 'pipe',
      stderr: 'pipe',
      windowsHide: true
    })
    const timer = setTimeout(() => proc.kill(), ARCHIVE_TIMEOUT_MS)
    const [out, err, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited
    ])
    clearTimeout(timer)
    log(`archive hook in ${worktreePath} exited ${code}${code ? `: ${(err || out).trim().slice(-500)}` : ''}`)
  } catch (error) {
    log(`archive hook in ${worktreePath} failed: ${String(error)}`)
  }
}

function hookEnv(project: Project, worktreePath: string): Record<string, string> {
  const name = basename(worktreePath)
  return {
    ORCA_ROOT_PATH: project.path,
    ORCA_WORKTREE_PATH: worktreePath,
    ORCA_WORKSPACE_NAME: name,
    ACP_HARNESS_ROOT_PATH: project.path,
    ACP_HARNESS_WORKTREE_PATH: worktreePath,
    ACP_HARNESS_WORKSPACE_NAME: name
  }
}

/** `call` each line and stop on the first failure, like Orca's cmd runner (npm/pnpm are batch files). */
function windowsRunner(script: string): string {
  let out = '@echo off\r\nsetlocal EnableExtensions DisableDelayedExpansion\r\n'
  for (const raw of script.split(/\r?\n/)) {
    const line = raw.trim()
    out += line ? `call ${line}\r\nif errorlevel 1 exit /b %errorlevel%\r\n` : '\r\n'
  }
  return out
}

function posixRunner(script: string): string {
  const body = script.replace(/\r\n/g, '\n').replace(/^#![^\n]*\n?/, '')
  return `#!/usr/bin/env bash\nset -e\n${body}\n`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}
