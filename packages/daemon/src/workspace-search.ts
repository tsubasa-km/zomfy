import type { SearchMatch, SearchParams, SearchResult } from '@acp-harness/protocol'
import { isGitRepository } from './git-cli.ts'

const MAX_MATCHES = 2000
const MAX_LINE = 400

/** Text search across a workspace: ripgrep when the host has it (respects .gitignore), else git grep. */
export async function searchWorkspace(root: string, params: SearchParams): Promise<SearchResult> {
  if (!params.query) return { matches: [], truncated: false }
  const rg = Bun.which('rg')
  if (rg) return ripgrep(rg, root, params)
  if (await isGitRepository(root)) return gitGrep(root, params)
  throw new Error('Search needs ripgrep (rg) or a git repository on this host')
}

async function ripgrep(rg: string, root: string, params: SearchParams): Promise<SearchResult> {
  const args = [
    '--no-config',
    '--json',
    '--hidden',
    '--glob', '!.git',
    '--max-columns', String(MAX_LINE),
    '--max-columns-preview',
    params.caseSensitive ? '--case-sensitive' : '--ignore-case',
    ...(params.wholeWord ? ['--word-regexp'] : []),
    ...(params.regex ? [] : ['--fixed-strings']),
    ...splitGlobs(params.include).flatMap((glob) => ['--glob', glob]),
    ...splitGlobs(params.exclude).flatMap((glob) => ['--glob', `!${glob}`]),
    '--',
    params.query,
    '.'
  ]
  const matches: SearchMatch[] = []
  let truncated = false
  for await (const line of run([rg, ...args], root)) {
    const event = JSON.parse(line)
    if (event.type !== 'match') continue
    const data = event.data
    const text: string = data.lines.text ?? ''
    const first = data.submatches[0]
    // rg reports byte offsets; the UI indexes UTF-16 characters.
    const bytes = Buffer.from(text)
    const start = first ? bytes.subarray(0, first.start).toString().length : 0
    const end = first ? bytes.subarray(0, first.end).toString().length : 0
    matches.push({
      path: normalize(data.path.text),
      line: data.line_number,
      column: start + 1,
      ...(first ? { length: end - start } : {}),
      text: text.replace(/\r?\n$/, '').slice(0, MAX_LINE)
    })
    if (matches.length >= MAX_MATCHES) {
      truncated = true
      break
    }
  }
  return { matches, truncated }
}

async function gitGrep(root: string, params: SearchParams): Promise<SearchResult> {
  const args = [
    'git', 'grep', '-n', '--column', '-I', '--no-color', '--untracked', '--exclude-standard',
    ...(params.caseSensitive ? [] : ['-i']),
    ...(params.wholeWord ? ['-w'] : []),
    ...(params.regex ? ['-E'] : ['-F']),
    '-e', params.query,
    '--',
    ...gitPathspecs(params)
  ]
  const matches: SearchMatch[] = []
  let truncated = false
  for await (const line of run(args, root)) {
    const match = /^(.*?):(\d+):(\d+):(.*)$/.exec(line)
    if (!match) continue
    matches.push({ path: normalize(match[1]!), line: Number(match[2]), column: Number(match[3]), text: match[4]!.slice(0, MAX_LINE) })
    if (matches.length >= MAX_MATCHES) {
      truncated = true
      break
    }
  }
  return { matches, truncated }
}

/** Streams stdout lines; stopping early kills the search instead of buffering every hit. */
async function* run(argv: string[], cwd: string): AsyncGenerator<string> {
  const proc = Bun.spawn(argv, { cwd, stdout: 'pipe', stderr: 'ignore', windowsHide: true })
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    for await (const chunk of proc.stdout) {
      buffer += decoder.decode(chunk, { stream: true })
      let newline: number
      while ((newline = buffer.indexOf('\n')) >= 0) {
        yield buffer.slice(0, newline)
        buffer = buffer.slice(newline + 1)
      }
    }
    if (buffer) yield buffer
  } finally {
    proc.kill()
  }
}

/** Comma-separated globs, keeping commas inside `{a,b}` groups (Orca's splitSearchGlobPatterns). */
export function splitGlobs(patterns: string | undefined): string[] {
  if (!patterns) return []
  const out: string[] = []
  let current = ''
  let depth = 0
  for (const ch of patterns) {
    if (ch === '{') depth++
    else if (ch === '}') depth = Math.max(0, depth - 1)
    if (ch === ',' && depth === 0) {
      if (current.trim()) out.push(current.trim())
      current = ''
      continue
    }
    current += ch
  }
  if (current.trim()) out.push(current.trim())
  return out
}

/** git grep matches pathspecs from the root, so a bare name or glob also matches at any depth and below. */
function gitPathspecs(params: SearchParams): string[] {
  const toSpecs = (glob: string, magic: string): string[] => {
    const trimmed = glob.replace(/\/+$/, '')
    if (!trimmed) return []
    const pattern = trimmed.includes('/') ? trimmed : `**/${trimmed}`
    return [`:(${magic})${pattern}`, `:(${magic})${pattern}/**`]
  }
  const include = splitGlobs(params.include).flatMap((g) => toSpecs(g, 'glob'))
  const exclude = splitGlobs(params.exclude).flatMap((g) => toSpecs(g, 'exclude,glob'))
  return [...(include.length ? include : ['.']), ...exclude]
}

function normalize(path: string): string {
  return path.replace(/^\.[\\/]/, '').replaceAll('\\', '/')
}
