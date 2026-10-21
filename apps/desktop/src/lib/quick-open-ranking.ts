// Orca's Quick Open ranking (shared/quick-open-path-search.ts, MIT), without the separator
// fallbacks: each query word must fuzzy-match the path in order; lower scores rank higher.
// Gaps between matched characters cost, matches after `/ . -` earn, filename hits earn most.

export const QUICK_OPEN_RESULT_LIMIT = 50

export interface IndexedPath {
  path: string
  lowerPath: string
  lowerFilename: string
  index: number
}

export function indexPaths(paths: readonly string[]): IndexedPath[] {
  return paths.map((path, index) => {
    const lowerPath = path.toLowerCase()
    return { path, lowerPath, lowerFilename: lowerPath.slice(lowerPath.lastIndexOf('/') + 1), index }
  })
}

function fuzzyScore(term: string, file: IndexedPath): number | null {
  let score = 0
  let last = -1
  for (const char of term) {
    const at = file.lowerPath.indexOf(char, last + 1)
    if (at === -1) return null
    if (last !== -1) score += at - last - 1
    const before = file.lowerPath[at - 1]
    if (at > 0 && (before === '/' || before === '.' || before === '-' || before === '_')) score -= 5
    last = at
  }
  if (file.lowerFilename.includes(term)) score -= 100
  return score
}

function compareNames(a: IndexedPath, b: IndexedPath): number {
  return a.path.localeCompare(b.path, undefined, { numeric: true, sensitivity: 'base' })
}

export function rankPaths(query: string, files: readonly IndexedPath[], limit = QUICK_OPEN_RESULT_LIMIT): IndexedPath[] {
  const terms = [...new Set(query.trim().replaceAll('\\', '/').toLowerCase().split(/\s+/))].filter(Boolean)
  if (terms.length === 0) return files.slice(0, limit)
  const scored: { file: IndexedPath; score: number }[] = []
  for (const file of files) {
    let total = 0
    let matched = true
    for (const term of terms) {
      const score = fuzzyScore(term, file)
      if (score === null) {
        matched = false
        break
      }
      total += score
    }
    if (matched) scored.push({ file, score: total })
  }
  scored.sort((a, b) => a.score - b.score || compareNames(a.file, b.file) || a.file.index - b.file.index)
  return scored.slice(0, limit).map((s) => s.file)
}
