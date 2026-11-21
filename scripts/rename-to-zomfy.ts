#!/usr/bin/env bun
/**
 * Rewrites the old project name ("acp-harness") to Zomfy across the tracked files.
 *
 * Safe to run again, e.g. after another branch is merged in: it only rewrites what still carries the
 * old name, and leaves alone what has to keep it on purpose:
 *   - any line that mentions "legacy" (the migration code that reads old homes, env vars and keys),
 *   - the repository folder and the GitHub repository name, which are not renamed,
 *   - the installed executable's name (`mainBinaryName`), which installed copies and shortcuts use.
 *
 * Usage: bun scripts/rename-to-zomfy.ts [--check]
 *   --check  only lists what would change and exits 1 when anything would.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const root = join(import.meta.dir, '..')
const check = process.argv.includes('--check')

/** Files that are never rewritten: this script, and the lockfile, which `bun install` regenerates. */
const SKIP_FILES = new Set(['scripts/rename-to-zomfy.ts', 'bun.lock'])
const SKIP_EXTENSIONS = /\.(png|ico|icns|jpg|jpeg|gif|webp|woff2?|ttf|otf|wasm|pdf|zip|exe)$/i

/** Lines containing any of these keep the old name. */
const KEEP_LINE = [/legacy/i, /"mainBinaryName"/]

/** Spans that keep the old name inside a line that is otherwise rewritten. */
const KEEP_SPANS = [
  /dev[\\/]+acp-harness/gi, // the repository checkout, C:\dev\acp-harness
  /workspaces[\\/]+acp-harness/gi, // existing worktrees named after the repository folder
  /github\.com[/:][\w.-]+\/acp-harness/gi
]

/** Applied in order; the prose rule turns a standalone mention in a sentence into the product name. */
const RULES: [RegExp, string | ((match: string, ...groups: string[]) => string)][] = [
  [/@acp-harness\//g, '@zomfy/'],
  [/acp_harness_desktop_lib/g, 'zomfy_desktop_lib'],
  [/ACP_HARNESS_/g, 'ZOMFY_'],
  [/ACP_HARNESS/g, 'ZOMFY'],
  [/AcpHarness/g, 'Zomfy'],
  [/acpHarness/g, 'zomfy'],
  [/acp_harness/g, 'zomfy'],
  // "Remove it from acp-harness?", "acp-harness does not run…", "acp-harness では…"
  [/(^|[\s('"`])acp-harness(?=[\s?,!)]|'s\b|\.(?:\s|$)|$)/gm, (_m, lead: string) => `${lead}Zomfy`],
  [/acp-harness/g, 'zomfy']
]

const PLACEHOLDER = '\u0000keep'

export function renameLine(line: string): string {
  if (!/acp[-_]?harness/i.test(line) || KEEP_LINE.some((re) => re.test(line))) return line
  const kept: string[] = []
  let out = line
  for (const span of KEEP_SPANS) {
    out = out.replace(span, (m) => {
      kept.push(m)
      return `${PLACEHOLDER}${kept.length - 1}\u0000`
    })
  }
  for (const [pattern, replacement] of RULES) {
    out = out.replace(pattern, replacement as never)
  }
  return out.replace(new RegExp(`${PLACEHOLDER}(\\d+)\u0000`, 'g'), (_m, i: string) => kept[Number(i)]!)
}

export function renameText(text: string): string {
  return text
    .split('\n')
    .map((line) => renameLine(line))
    .join('\n')
}

function trackedFiles(): string[] {
  const out = Bun.spawnSync(['git', 'ls-files', '-z'], { cwd: root }).stdout.toString()
  return out.split('\0').filter(Boolean)
}

if (import.meta.main) {
  const changed: string[] = []
  for (const file of trackedFiles()) {
    if (SKIP_FILES.has(file) || SKIP_EXTENSIONS.test(file)) continue
    const path = join(root, file)
    let text: string
    try {
      text = readFileSync(path, 'utf8')
    } catch {
      continue // deleted in the working tree
    }
    if (text.includes('\u0000')) continue // binary
    const next = renameText(text)
    if (next === text) continue
    changed.push(file)
    if (!check) writeFileSync(path, next)
  }
  for (const file of changed) console.log(`${check ? 'would change' : 'changed'} ${file}`)
  console.log(`${changed.length} file(s) ${check ? 'would change' : 'changed'}`)
  if (check && changed.length > 0) process.exit(1)
}
