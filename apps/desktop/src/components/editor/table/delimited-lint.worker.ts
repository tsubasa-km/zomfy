import { RowScanner, countFields, type Delimiter, type UnterminatedQuote } from './delimited-scan'

// The structure check behind the source's squiggles: reads a whole file's rows off the main
// thread and reports the ones that do not fit, with the same reader the table uses.

export interface LintRequest {
  id: number
  text: string
  delimiter: Delimiter
  /** At most this many uneven rows are listed; all are counted. */
  limit: number
}

export interface LintResult {
  id: number
  /** Field count of the first row. */
  expected: number
  /** Uneven rows in file order: the line each starts on and its field count. */
  uneven: { line: number; fields: number }[]
  unevenTotal: number
  unterminated: UnterminatedQuote | null
}

const scope = self as unknown as { postMessage(message: LintResult): void; addEventListener(type: 'message', listener: (event: MessageEvent<LintRequest>) => void): void }

scope.addEventListener('message', (event) => {
  const { id, text, delimiter, limit } = event.data
  const scanner = new RowScanner(delimiter)
  scanner.push(text)
  scanner.finish()
  const uneven: LintResult['uneven'] = []
  for (let i = 0; i < scanner.uneven.length && i < limit; i++) {
    const row = scanner.uneven.at(i)
    uneven.push({ line: scanner.rowLine.at(row), fields: countFields(text, scanner.rowStart.at(row), delimiter) })
  }
  scope.postMessage({ id, expected: scanner.expected, uneven, unevenTotal: scanner.uneven.length, unterminated: scanner.unterminated })
})
