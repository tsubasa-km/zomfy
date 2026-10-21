import { readFile, stat } from 'node:fs/promises'
import type { ReplaceParams, ReplaceResult } from '@acp-harness/protocol'
import { resolveInside, writeWorkspaceFile } from './workspace-files.ts'

const MAX_FILE = 16 * 1024 * 1024

/** The search query as a JS pattern; close to ripgrep's syntax for everyday regexes. */
export function searchPattern(params: Pick<ReplaceParams, 'query' | 'regex' | 'caseSensitive' | 'wholeWord'>): RegExp {
  const source = params.regex ? params.query : params.query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(params.wholeWord ? `\\b(?:${source})\\b` : source, `g${params.caseSensitive ? '' : 'i'}`)
}

/** Replaces matches in the given files (or one line of one file), through the same atomic save as the editor. */
export async function replaceInWorkspace(root: string, params: ReplaceParams): Promise<ReplaceResult> {
  if (!params.query) return { files: 0, replacements: 0 }
  const pattern = searchPattern(params)
  // Literal mode inserts the text as typed; regex mode allows $1 group references, as VS Code does.
  const replace = (text: string): [string, number] => {
    let count = 0
    const next = text.replace(pattern, (...args) => {
      count++
      if (!params.regex) return params.replacement
      // Trailing args are offset, input and (with named groups) the groups object.
      const named = typeof args[args.length - 1] === 'object'
      const groups = args.slice(1, named ? -3 : -2) as (string | undefined)[]
      return params.replacement.replace(/\$(\$|&|\d{1,2})/g, (token, ref: string) =>
        ref === '$' ? '$' : ref === '&' ? String(args[0]) : (groups[Number(ref) - 1] ?? token)
      )
    })
    return [next, count]
  }

  let files = 0
  let replacements = 0
  for (const path of params.paths) {
    const absolute = await resolveInside(root, path)
    const info = await stat(absolute)
    if (!info.isFile() || info.size > MAX_FILE) continue
    const buffer = await readFile(absolute)
    if (buffer.subarray(0, 8192).includes(0)) continue
    const content = buffer.toString('utf8')
    let next: string
    let count: number
    if (params.line !== undefined) {
      // Keep each line's own ending so CRLF files stay CRLF.
      const lines = content.split(/(?<=\n)/)
      const index = params.line - 1
      const original = lines[index]
      if (original === undefined) continue
      const ending = /\r?\n$/.exec(original)?.[0] ?? ''
      const [replaced, n] = replace(original.slice(0, original.length - ending.length))
      lines[index] = replaced + ending
      next = lines.join('')
      count = n
    } else {
      ;[next, count] = replace(content)
    }
    if (count === 0) continue
    await writeWorkspaceFile(root, path, next, info.mtimeMs)
    files++
    replacements += count
  }
  return { files, replacements }
}
