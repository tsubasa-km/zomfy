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
    '--json',
    '--max-columns', String(MAX_LINE),
    '--max-columns-preview',
    params.caseSensitive ? '--case-sensitive' : '--ignore-case',
    ...(params.regex ? [] : ['--fixed-strings']),
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
    matches.push({
      path: normalize(data.path.text),
      line: data.line_number,
      column: (data.submatches[0]?.start ?? 0) + 1,
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
    ...(params.regex ? ['-E'] : ['-F']),
    '-e', params.query
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

function normalize(path: string): string {
  return path.replace(/^\.[\\/]/, '').replaceAll('\\', '/')
}
