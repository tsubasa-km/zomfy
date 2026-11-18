import { describe, expect, test } from 'bun:test'
import { RowScanner, locateColumn, readRecord, sniffDelimiter, tsvCell } from '../src/components/editor/table/delimited-scan.ts'
import { CHUNK_CHARS, DelimitedDataset, PLAIN_VIEW, runToEnd, type ViewSpec } from '../src/components/editor/table/delimited-dataset.ts'
import { detectColumnType, parseDate, parseNumber, sortPositions } from '../src/components/editor/table/delimited-sort.ts'

/** Every row of `text`, read the way the table reads it. */
function parse(text: string, delimiter = ',', chunk = text.length || 1): { rows: string[][]; lines: number[]; scanner: RowScanner } {
  const scanner = new RowScanner(delimiter)
  for (let i = 0; i < text.length; i += chunk) scanner.push(text.slice(i, i + chunk))
  scanner.finish()
  const rows: string[][] = []
  for (let r = 0; r < scanner.rows; r++) rows.push(readRecord(text, scanner.rowStart.at(r), delimiter))
  return { rows, lines: [...scanner.rowLine.view()], scanner }
}

describe('reading rows', () => {
  test('plain fields, with and without a final line break', () => {
    expect(parse('a,b,c\n1,2,3\n').rows).toEqual([['a', 'b', 'c'], ['1', '2', '3']])
    expect(parse('a,b,c\n1,2,3').rows).toEqual([['a', 'b', 'c'], ['1', '2', '3']])
  })

  test('quoted fields keep delimiters, doubled quotes and line breaks', () => {
    const { rows, lines } = parse('name,note\n"Doe, Jane","said ""hi"""\n"two\nlines",x\nlast,y\n')
    expect(rows).toEqual([['name', 'note'], ['Doe, Jane', 'said "hi"'], ['two\nlines', 'x'], ['last', 'y']])
    expect(lines).toEqual([1, 2, 3, 5])
  })

  test('a quote inside an unquoted field is an ordinary character, and text after a closing quote stays', () => {
    expect(parse('5" nail,"big"ger,""\n').rows).toEqual([['5" nail', 'bigger', '']])
  })

  test('empty fields at the edges of a row', () => {
    expect(parse(',a,\n,,\n').rows).toEqual([['', 'a', ''], ['', '', '']])
  })

  test('CRLF, bare CR and LF all end a row and count one line each', () => {
    const { rows, lines } = parse('a,b\r\n1,2\r3,4\n5,6\r\n')
    expect(rows).toEqual([['a', 'b'], ['1', '2'], ['3', '4'], ['5', '6']])
    expect(lines).toEqual([1, 2, 3, 4])
  })

  test('a CRLF inside quotes is one line', () => {
    const { rows, lines } = parse('a,b\r\n"x\r\ny",2\r\n3,4\r\n')
    expect(rows[1]).toEqual(['x\r\ny', '2'])
    expect(lines).toEqual([1, 2, 4])
  })

  test('a byte-order mark is not part of the first field', () => {
    const { rows, scanner } = parse('﻿id,name\n1,x\n')
    expect(rows[0]).toEqual(['id', 'name'])
    expect(scanner.rowStart.at(0)).toBe(1)
  })

  test('blank lines are not rows, but lines still count', () => {
    const { rows, lines, scanner } = parse('\na,b\n\n1,2\n\n')
    expect(rows).toEqual([['a', 'b'], ['1', '2']])
    expect(lines).toEqual([2, 4])
    expect(scanner.uneven.length).toBe(0)
  })

  test('in a one-column table a blank line is an empty value', () => {
    expect(parse('name\nx\n\ny\n').rows).toEqual([['name'], ['x'], [''], ['y']])
  })

  test('rows with another field count than the first are reported, not padded', () => {
    const { rows, scanner } = parse('a,b,c\n1,2\n1,2,3\n1,2,3,4\n')
    expect(rows.map((r) => r.length)).toEqual([3, 2, 3, 4])
    expect([...scanner.uneven.view()]).toEqual([1, 3])
    expect(scanner.expected).toBe(3)
    expect(scanner.maxFields).toBe(4)
  })

  test('an unterminated quote is reported where it opens and swallows the rest', () => {
    const { rows, scanner } = parse('a,b\n1,"open\n2,3\n')
    expect(rows).toEqual([['a', 'b'], ['1', 'open\n2,3\n']])
    expect(scanner.unterminated).toEqual({ row: 1, line: 2, column: 3 })
  })

  test('a properly closed last quote is not unterminated', () => {
    expect(parse('a\n"x"').scanner.unterminated).toBeNull()
    expect(parse('a\n"x""').scanner.unterminated).not.toBeNull()
  })

  test('chunks of any size give the same rows as one pass', () => {
    const text = '﻿id,name,note\r\n1,"Doe, Jane","said ""hi"""\r\n2,"two\r\nlines",x\r\n\r\n3,short\r\n4,"a""",z\r\n5,"open\r\n'
    const whole = parse(text)
    for (const size of [1, 2, 3, 5, 7, 11, 64]) {
      const pieces = parse(text, ',', size)
      expect(pieces.rows).toEqual(whole.rows)
      expect(pieces.lines).toEqual(whole.lines)
      expect([...pieces.scanner.rowStart.view()]).toEqual([...whole.scanner.rowStart.view()])
      expect([...pieces.scanner.uneven.view()]).toEqual([...whole.scanner.uneven.view()])
      expect(pieces.scanner.unterminated).toEqual(whole.scanner.unterminated)
    }
  })

  test('other delimiters', () => {
    expect(parse('a\tb\n"x\ty"\tz\n', '\t').rows).toEqual([['a', 'b'], ['x\ty', 'z']])
    expect(parse('a|b\n1|2\n', '|').rows).toEqual([['a', 'b'], ['1', '2']])
  })

  test('a field is found in the source by line and column', () => {
    const text = 'a,b,c\n"x\ny",2,3\n'
    const start = parse(text).scanner.rowStart.at(1)
    expect(locateColumn(text, start, ',', 0)).toEqual({ lineDelta: 0, column: 1 })
    expect(locateColumn(text, start, ',', 1)).toEqual({ lineDelta: 1, column: 4 })
    expect(locateColumn(text, start, ',', 2)).toEqual({ lineDelta: 1, column: 6 })
    expect(locateColumn(text, start, ',', 3)).toBeNull()
  })
})

describe('sniffing the delimiter', () => {
  test('finds each of the four', () => {
    expect(sniffDelimiter('a,b,c\n1,2,3\n', ',')).toBe(',')
    expect(sniffDelimiter('a\tb\tc\n1\t2\t3\n', ',')).toBe('\t')
    expect(sniffDelimiter('a;b;c\n1;2;3\n', ',')).toBe(';')
    expect(sniffDelimiter('a|b|c\n1|2|3\n', ',')).toBe('|')
  })

  test('decimal commas do not beat the semicolons around them', () => {
    expect(sniffDelimiter('x;y;z\n1,5;2,5;3,5\n4,5;5,5;6,5\n', ',')).toBe(';')
  })

  test('delimiters inside quotes do not count', () => {
    expect(sniffDelimiter('name\tnote\n"a,b,c"\t"d,e"\n"f,g"\th\n', ',')).toBe('\t')
  })

  test('the extension decides a tie and a file with nothing to split', () => {
    expect(sniffDelimiter('a,b;c\n1,2;3\n', ';')).toBe(';')
    expect(sniffDelimiter('a,b;c\n1,2;3\n', ',')).toBe(',')
    expect(sniffDelimiter('single\nvalues\n', '\t')).toBe('\t')
    expect(sniffDelimiter('', '|')).toBe('|')
  })
})

describe('clipboard cells', () => {
  test('only values a spreadsheet would misread are quoted', () => {
    expect(tsvCell('plain, with "quotes" inside')).toBe('plain, with "quotes" inside')
    expect(tsvCell('a\tb')).toBe('"a\tb"')
    expect(tsvCell('two\nlines "x"')).toBe('"two\nlines ""x"""')
    expect(tsvCell('"starts quoted')).toBe('"""starts quoted"')
  })
})

describe('sorting', () => {
  const sorted = (values: (string | null)[], direction: 'asc' | 'desc' = 'asc'): (string | null)[] =>
    [...sortPositions(values, direction)].map((i) => values[i])

  test('numbers by value, however they are written', () => {
    expect(parseNumber('1,234.5')).toBe(1234.5)
    expect(parseNumber('-12%')).toBe(-12)
    expect(parseNumber('$1,000')).toBe(1000)
    expect(parseNumber('1e3')).toBe(1000)
    expect(parseNumber('12a')).toBeNaN()
    expect(parseNumber('')).toBeNaN()
    expect(sorted(['10', '9', '-1', '1,000', '2.5'])).toEqual(['-1', '2.5', '9', '10', '1,000'])
    expect(sorted(['10', '9', '100'], 'desc')).toEqual(['100', '10', '9'])
  })

  test('dates by time', () => {
    expect(parseDate('2024-01-05')).toBe(Date.UTC(2024, 0, 5))
    expect(parseDate('2024/1/5 13:45')).toBe(Date.UTC(2024, 0, 5, 13, 45))
    expect(parseDate('2024-01-05T00:00:00+09:00')).toBe(Date.UTC(2024, 0, 4, 15))
    expect(parseDate('2024年1月5日')).toBe(Date.UTC(2024, 0, 5))
    expect(parseDate('2024-13-01')).toBeNaN()
    expect(detectColumnType(['2024-01-05', '', '2023/12/31'])).toBe('date')
    expect(sorted(['2024-02-01', '2023/12/31', '2024-01-15T08:00:00Z'])).toEqual(['2023/12/31', '2024-01-15T08:00:00Z', '2024-02-01'])
  })

  test('a column with one value that is not a number sorts as text, digits by value', () => {
    expect(detectColumnType(['1', '2', 'n/a'])).toBe('text')
    expect(detectColumnType(['1', '', '2'])).toBe('number')
    expect(detectColumnType(['', ''])).toBe('text')
    expect(sorted(['file10', 'File2', 'file1'])).toEqual(['file1', 'File2', 'file10'])
  })

  test('empty and missing values go last in both directions', () => {
    expect(sorted(['b', '', 'a', null])).toEqual(['a', 'b', '', null])
    expect(sorted(['b', '', 'a', null], 'desc')).toEqual(['b', 'a', '', null])
    expect(sorted(['2', '', '1'], 'desc')).toEqual(['2', '1', ''])
  })

  test('equal values keep the order of the file', () => {
    expect([...sortPositions(['x', 'a', 'x', 'a'], 'asc')]).toEqual([1, 3, 0, 2])
    expect([...sortPositions(['x', 'a', 'x', 'a'], 'desc')]).toEqual([0, 2, 1, 3])
    expect([...sortPositions(['1', '1.0', '0'], 'desc')]).toEqual([0, 1, 2])
  })
})

describe('the dataset behind the table', () => {
  function load(text: string, chunk = CHUNK_CHARS): DelimitedDataset {
    const data = new DelimitedDataset('auto', ',', chunk)
    for (let i = 0; i < text.length; i += chunk) data.push(text.slice(i, i + chunk))
    data.finish()
    return data
  }
  function show(data: DelimitedDataset, spec: Partial<ViewSpec>): string[] {
    data.view = runToEnd(data.computeView({ ...PLAIN_VIEW, ...spec }))
    const names: string[] = []
    for (let r = 0; r < data.viewCount; r++) names.push(data.cell(r, 0) ?? '')
    return names
  }
  const people = 'name,age,city\nCarol,41,Osaka\nalice,9,"Tokyo, Minato"\nBob,30,osaka\nDave,,Nagoya\n'

  test('sniffs, counts and serves blocks', () => {
    const data = load('a;b\n1;2\n3;4;5\n')
    expect(data.delimiter).toBe(';')
    expect([data.rows, data.columns, data.expected, data.unevenRows]).toEqual([3, 3, 2, 1])
    data.view = runToEnd(data.computeView(PLAIN_VIEW))
    const block = data.block(0, 0)
    expect(block.names).toEqual(['a', 'b'])
    expect(block.cells.map((row) => row.slice(0, 3))).toEqual([['1', '2', null], ['3', '4', '5']])
    expect(block.fields).toEqual([2, 3])
    expect(block.line).toEqual([2, 3])
    expect(block.source).toEqual([1, 2])
  })

  test('the header row can be data', () => {
    const data = load(people)
    expect(show(data, { header: false })).toEqual(['name', 'Carol', 'alice', 'Bob', 'Dave'])
    expect(data.block(0, 0).names).toBeNull()
  })

  test('sorts by a column with the type it finds', () => {
    const data = load(people)
    expect(show(data, { sort: { column: 1, direction: 'asc' } })).toEqual(['alice', 'Bob', 'Carol', 'Dave'])
    expect(data.view.sortType).toBe('number')
    expect(show(data, { sort: { column: 0, direction: 'desc' } })).toEqual(['Dave', 'Carol', 'Bob', 'alice'])
    expect(data.view.sortType).toBe('text')
  })

  test('searches every cell and filters single columns, case aside', () => {
    const data = load(people)
    expect(show(data, { search: 'OSAKA' })).toEqual(['Carol', 'Bob'])
    expect(show(data, { search: 'o, m' })).toEqual(['alice'])
    expect(show(data, { search: 'name' })).toEqual([])
    expect(show(data, { filters: [{ column: 2, text: 'o' }] })).toEqual(['Carol', 'alice', 'Bob', 'Dave'])
    expect(show(data, { filters: [{ column: 0, text: 'o' }] })).toEqual(['Carol', 'Bob'])
    expect(show(data, { search: 'osaka', filters: [{ column: 1, text: '3' }], sort: { column: 0, direction: 'asc' } })).toEqual(['Bob'])
  })

  test('shows only the rows with problems', () => {
    const data = load('a,b\n1,2\n3\n4,5\n6,"open\n')
    expect(show(data, { problemsOnly: true })).toEqual(['3', '6'])
    expect(data.unterminated?.line).toBe(5)
  })

  test('rows that straddle chunks read whole, and a search finds text across the seam', () => {
    const rows = Array.from({ length: 200 }, (_, i) => `row${i},"value ${i}, with a comma",needle${i % 7}x`)
    const text = `id,note,tag\n${rows.join('\n')}\n`
    const expected = rows.filter((r) => r.endsWith('needle3x')).map((r) => r.slice(0, r.indexOf(',')))
    for (const size of [text.length, 37, 16, 5]) {
      const data = load(text, size)
      expect(data.rows).toBe(201)
      expect(show(data, { search: 'needle3x' })).toEqual(expected)
      expect(show(data, { search: 'value 19,' })).toEqual(['row19'])
      expect(show(data, { filters: [{ column: 1, text: 'value 42,' }] })).toEqual(['row42'])
      expect(show(data, {}).length).toBe(200)
      expect(data.block(3, 0).cells[0].slice(0, 3)).toEqual(['row192', 'value 192, with a comma', 'needle3x'])
    }
  })

  test('copies a range as tab-separated text, with names when asked', () => {
    const data = load(people)
    show(data, {})
    expect(runToEnd(data.copy({ rowFrom: 0, rowTo: 1, colFrom: 0, colTo: 2 }, false))).toBe('Carol\t41\tOsaka\nalice\t9\tTokyo, Minato')
    expect(runToEnd(data.copy({ rowFrom: 3, rowTo: 3, colFrom: 1, colTo: 2 }, true))).toBe('age\tcity\n\tNagoya')
  })

  test('finds a cell in the source and the widest value of a column', () => {
    const data = load('﻿a,b\n"x\ny",long value here\n1,2\n')
    show(data, {})
    expect(data.locate(0, 1)).toEqual({ line: 3, column: 4 })
    expect(data.locate(1, 0)).toEqual({ line: 4, column: 1 })
    expect(runToEnd(data.widest(1))).toBe('long value here')
    expect(data.sample(2, 10).types).toEqual(['text', 'text'])
  })

  test('long cells are cut for the grid and whole on request', () => {
    const long = 'x'.repeat(1000)
    const data = load(`a,b\n${long},1\n`)
    show(data, {})
    const block = data.block(0, 0)
    expect(block.cells[0][0]?.length).toBe(400)
    expect(block.cut).toEqual([[0, 0, 1000]])
    expect(data.cell(0, 0)).toBe(long)
  })
})
