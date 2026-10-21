import type { QuickOpenFileList } from '@acp-harness/protocol'
import { isGitRepository } from './git-cli.ts'

// Orca's Quick Open listing (shared/quick-open-filter.ts, quick-open-listing-limits.ts, MIT).
const MAX_FILES = 20_000

// Tool-generated caches only; user-authored dotdirs (.github, .config) stay listed.
const PRUNED_DIRS = [
  'node_modules', '.git', '.next', '.nuxt', '.cache', '.stably', '.vscode', '.idea', '.yarn',
  '.pnpm-store', '.terraform', '.docker', '.husky', '.npm', '.npm-global', '.gvfs'
]

/** Every file Ctrl+P can open: ripgrep's `--files` (respects .gitignore), else `git ls-files`. */
export async function listWorkspaceFiles(root: string): Promise<QuickOpenFileList> {
  const rg = Bun.which('rg')
  if (rg) {
    const globs = PRUNED_DIRS.flatMap((name) => ['--glob', `!**/${name}`])
    return collect([rg, '--files', '--no-config', '--null', '--hidden', ...globs, '.'], root)
  }
  if (await isGitRepository(root)) {
    return collect(['git', 'ls-files', '-z', '--cached', '--others', '--exclude-standard'], root)
  }
  throw new Error('Quick open needs ripgrep (rg) or a git repository on this host')
}

/** Reads NUL-separated paths and stops the process once the cap is reached. */
async function collect(argv: string[], cwd: string): Promise<QuickOpenFileList> {
  const proc = Bun.spawn(argv, { cwd, stdout: 'pipe', stderr: 'ignore', windowsHide: true })
  const decoder = new TextDecoder()
  const files: string[] = []
  let buffer = ''
  let truncated = false
  try {
    for await (const chunk of proc.stdout) {
      buffer += decoder.decode(chunk, { stream: true })
      const records = buffer.split('\0')
      buffer = records.pop() ?? ''
      for (const record of records) {
        const path = normalize(record)
        if (!path || isPruned(path)) continue
        if (files.length >= MAX_FILES) {
          truncated = true
          break
        }
        files.push(path)
      }
      if (truncated) break
    }
    if (!truncated && buffer && !isPruned(normalize(buffer))) files.push(normalize(buffer))
  } finally {
    proc.kill()
  }
  return { files, truncated }
}

function normalize(path: string): string {
  return path.replace(/^\.[\\/]/, '').replaceAll('\\', '/')
}

/** Backstop for paths git lists, which the rg globs never see. */
function isPruned(path: string): boolean {
  return path.split('/').slice(0, -1).some((segment) => PRUNED_DIRS.includes(segment))
}
