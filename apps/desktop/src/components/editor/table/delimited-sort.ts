// Ordering a table by one column. A column sorts as numbers or as dates only when every value in
// it that is not empty reads as one; anything else sorts as text. Empty values go last in both
// directions, and rows that compare equal keep the order they have in the file.

export type ColumnType = 'number' | 'date' | 'text'
export type SortDirection = 'asc' | 'desc'

const NUMBER = /^\s*[+-]?[$¥€£]?(?:\d{1,3}(?:,\d{3})+|\d+)?(?:\.\d+)?(?:[eE][+-]?\d+)?\s*%?\s*$/
const PLAIN_NUMBER = /^[+-]?\d+(?:\.\d+)?$/
const DATE = /^\s*(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2})(?:[.,](\d{1,9}))?)?\s*(Z|[+-]\d{2}:?\d{2})?)?\s*$/
const DATE_JA = /^\s*(\d{4})年(\d{1,2})月(\d{1,2})日\s*$/

/** The number a cell shows (thousands separators, a currency sign and a percent sign allowed), or NaN. */
export function parseNumber(value: string): number {
  if (PLAIN_NUMBER.test(value)) return Number(value)
  if (!NUMBER.test(value) || !/\d/.test(value)) return NaN
  return Number(value.replace(/[\s,$¥€£%]/g, ''))
}

/** Milliseconds for a year-first date (2024-01-05, 2024/1/5 13:45, ISO 8601, 2024年1月5日), or NaN. */
export function parseDate(value: string): number {
  const m = DATE.exec(value) ?? DATE_JA.exec(value)
  if (!m) return NaN
  const month = Number(m[2])
  const day = Number(m[3])
  const hour = Number(m[4] ?? 0)
  const minute = Number(m[5] ?? 0)
  const second = Number(m[6] ?? 0)
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 24 || minute > 59 || second > 60) return NaN
  const millis = m[7] ? Number(`0.${m[7]}`) * 1000 : 0
  let time = Date.UTC(Number(m[1]), month - 1, day, hour, minute, second, millis)
  const zone = m[8]
  if (zone && zone !== 'Z') {
    const digits = zone.replace(':', '')
    const offset = Number(digits.slice(1, 3)) * 60 + Number(digits.slice(3, 5))
    time -= (digits[0] === '-' ? -offset : offset) * 60_000
  }
  return time
}

export function detectColumnType(values: ArrayLike<string | null>): ColumnType {
  let numbers = true
  let dates = true
  let filled = 0
  for (let i = 0; i < values.length && (numbers || dates); i++) {
    const value = values[i]
    if (value === null || value === '') continue
    filled++
    if (numbers && Number.isNaN(parseNumber(value))) numbers = false
    if (dates && Number.isNaN(parseDate(value))) dates = false
  }
  if (filled === 0) return 'text'
  return numbers ? 'number' : dates ? 'date' : 'text'
}

// Text compares the way a person reads a list: case and accents aside, digits by their value.
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

/** Above this many rows text sorts by lower-cased code units: the collator takes seconds per million rows. */
export const NATURAL_SORT_MAX_ROWS = 200_000

/**
 * The positions 0..values.length-1 in sorted order. `values[i]` is the cell of the i-th row in
 * hand; null (a row too short to have the column) sorts with the empty values.
 */
export function sortPositions(values: ArrayLike<string | null>, direction: SortDirection, type: ColumnType = detectColumnType(values)): Uint32Array {
  const n = values.length
  const sign = direction === 'asc' ? 1 : -1
  const order = new Uint32Array(n)
  for (let i = 0; i < n; i++) order[i] = i
  if (type === 'text') {
    const natural = n <= NATURAL_SORT_MAX_ROWS
    const keys = new Array<string>(n)
    for (let i = 0; i < n; i++) {
      const value = values[i] ?? ''
      keys[i] = natural ? value : value.toLowerCase()
    }
    order.sort((a, b) => {
      const x = keys[a]
      const y = keys[b]
      if (x === y) return a - b
      if (x === '') return 1
      if (y === '') return -1
      const compared = natural ? collator.compare(x, y) : x < y ? -1 : 1
      return compared === 0 ? a - b : sign * compared
    })
    return order
  }
  const keys = new Float64Array(n)
  const parse = type === 'number' ? parseNumber : parseDate
  for (let i = 0; i < n; i++) {
    const value = values[i]
    keys[i] = value === null || value === '' ? NaN : parse(value)
  }
  order.sort((a, b) => {
    const x = keys[a]
    const y = keys[b]
    if (x === y) return a - b
    // NaN is an empty cell (or, when the caller forced a type, one that does not read as it).
    if (x !== x) return y !== y ? a - b : 1
    if (y !== y) return -1
    return sign * (x < y ? -1 : 1)
  })
  return order
}
