import { describe, expect, test } from 'bun:test'
// Monaco's enum tables are plain data; the editor itself cannot load outside a browser.
// @ts-expect-error no typings for this internal module
import * as enums from 'monaco-editor/esm/vs/editor/common/standalone/standaloneEnums.js'
import { lspDocumentUri, parseLspDocumentUri } from '@zomfy/protocol'
import {
  MONACO_MARKER_SEVERITY,
  applyTextEdits,
  diagnosticsForMarkers,
  locationUris,
  toCompletionItem,
  toDocumentHighlight,
  toDocumentSymbols,
  toHover,
  toLocations,
  toLspContentChanges,
  toLspPosition,
  toLspRange,
  toMarkdown,
  toMarker,
  toMonacoPosition,
  toMonacoRange,
  toSignatureHelp,
  toTextEdit,
  withDefaultData,
  workspaceEditSteps,
  type ParseUri
} from '../src/lib/lsp/lsp-convert.ts'
import type { LspCompletionItem, LspTextEdit } from '../src/lib/lsp/lsp-types.ts'

const parseUri = ((uri: string) => ({ wire: uri })) as unknown as ParseUri
const range = (sl: number, sc: number, el: number, ec: number) => ({ start: { line: sl, character: sc }, end: { line: el, character: ec } })
const WORD = {
  insert: { startLineNumber: 3, startColumn: 5, endLineNumber: 3, endColumn: 8 },
  replace: { startLineNumber: 3, startColumn: 5, endLineNumber: 3, endColumn: 11 }
}

describe('positions and ranges', () => {
  test('LSP counts from 0, Monaco from 1, both in UTF-16 units', () => {
    expect(toLspPosition({ lineNumber: 1, column: 1 })).toEqual({ line: 0, character: 0 })
    expect(toMonacoPosition({ line: 9, character: 4 })).toEqual({ lineNumber: 10, column: 5 })
    // "𝒳" is two UTF-16 units in both worlds, so the column after it moves by two either way.
    const afterAstral = '𝒳'.length
    expect(toLspPosition({ lineNumber: 1, column: 1 + afterAstral })).toEqual({ line: 0, character: 2 })
    const monaco = { startLineNumber: 2, startColumn: 3, endLineNumber: 4, endColumn: 1 }
    expect(toLspRange(monaco)).toEqual(range(1, 2, 3, 0))
    expect(toMonacoRange(toLspRange(monaco))).toEqual(monaco)
  })
})

describe('Monaco enum values', () => {
  test('completion kinds map to the kinds Monaco names the same', () => {
    const lspKinds = ['Text', 'Method', 'Function', 'Constructor', 'Field', 'Variable', 'Class', 'Interface', 'Module', 'Property', 'Unit', 'Value', 'Enum', 'Keyword', 'Snippet', 'Color', 'File', 'Reference', 'Folder', 'EnumMember', 'Constant', 'Struct', 'Event', 'Operator', 'TypeParameter']
    lspKinds.forEach((name, index) => {
      expect([name, toCompletionItem({ label: 'x', kind: index + 1 }, undefined, WORD).kind]).toEqual([name, enums.CompletionItemKind[name]])
    })
    expect(toCompletionItem({ label: 'x' }, undefined, WORD).kind).toBe(enums.CompletionItemKind.Text)
    expect(toCompletionItem({ label: 'x', kind: 99 }, undefined, WORD).kind).toBe(enums.CompletionItemKind.Text)
  })

  test('severities, insert rules, symbol and highlight kinds', () => {
    expect(MONACO_MARKER_SEVERITY).toEqual({ Hint: enums.MarkerSeverity.Hint, Info: enums.MarkerSeverity.Info, Warning: enums.MarkerSeverity.Warning, Error: enums.MarkerSeverity.Error })
    expect(toCompletionItem({ label: 'x', insertTextFormat: 2 }, undefined, WORD).insertTextRules).toBe(enums.CompletionItemInsertTextRule.InsertAsSnippet)
    expect(toCompletionItem({ label: 'x', insertTextMode: 1 }, undefined, WORD).insertTextRules).toBe(enums.CompletionItemInsertTextRule.KeepWhitespace)
    const lspSymbolKinds = ['File', 'Module', 'Namespace', 'Package', 'Class', 'Method', 'Property', 'Field', 'Constructor', 'Enum', 'Interface', 'Function', 'Variable', 'Constant', 'String', 'Number', 'Boolean', 'Array', 'Object', 'Key', 'Null', 'EnumMember', 'Struct', 'Event', 'Operator', 'TypeParameter']
    lspSymbolKinds.forEach((name, index) => {
      const [symbol] = toDocumentSymbols([{ name, kind: index + 1, range: range(0, 0, 0, 1), selectionRange: range(0, 0, 0, 1) }])
      expect([name, symbol!.kind]).toEqual([name, enums.SymbolKind[name]])
    })
    expect(toDocumentHighlight({ range: range(0, 0, 0, 1), kind: 1 }).kind).toBe(enums.DocumentHighlightKind.Text)
    expect(toDocumentHighlight({ range: range(0, 0, 0, 1), kind: 3 }).kind).toBe(enums.DocumentHighlightKind.Write)
    // Kinds the providers pass through or shift by one rely on these.
    expect([enums.CompletionTriggerKind.Invoke, enums.CompletionTriggerKind.TriggerCharacter, enums.CompletionTriggerKind.TriggerForIncompleteCompletions]).toEqual([0, 1, 2])
    expect([enums.SignatureHelpTriggerKind.Invoke, enums.SignatureHelpTriggerKind.TriggerCharacter, enums.SignatureHelpTriggerKind.ContentChange]).toEqual([1, 2, 3])
    expect([enums.CodeActionTriggerType.Invoke, enums.CodeActionTriggerType.Auto]).toEqual([1, 2])
    expect([enums.MarkerTag.Unnecessary, enums.MarkerTag.Deprecated, enums.CompletionItemTag.Deprecated, enums.SymbolTag.Deprecated]).toEqual([1, 2, 1, 1])
  })
})

describe('completion items', () => {
  test('a bare item completes the word under the cursor with its label', () => {
    expect(toCompletionItem({ label: 'push', kind: 2, detail: '(method) push(): void', sortText: '11', filterText: 'push', preselect: true }, undefined, WORD)).toEqual({
      label: 'push',
      kind: enums.CompletionItemKind.Method,
      insertText: 'push',
      range: WORD,
      detail: '(method) push(): void',
      sortText: '11',
      filterText: 'push',
      preselect: true
    })
  })

  test('a text edit names its own range and text, and a snippet is inserted as one', () => {
    const item = toCompletionItem({ label: 'forEach', insertText: 'ignored', insertTextFormat: 2, textEdit: { range: range(2, 4, 2, 7), newText: 'forEach((${1:item}) => {\n\t$0\n})' } }, undefined, WORD)
    expect(item.range).toEqual({ startLineNumber: 3, startColumn: 5, endLineNumber: 3, endColumn: 8 })
    expect(item.insertText).toBe('forEach((${1:item}) => {\n\t$0\n})')
    expect(item.insertTextRules).toBe(enums.CompletionItemInsertTextRule.InsertAsSnippet)
  })

  test('an insert/replace edit keeps both ranges', () => {
    const item = toCompletionItem({ label: 'value', textEdit: { insert: range(0, 2, 0, 4), replace: range(0, 2, 0, 9), newText: 'value' } }, undefined, WORD)
    expect(item.range).toEqual({
      insert: { startLineNumber: 1, startColumn: 3, endLineNumber: 1, endColumn: 5 },
      replace: { startLineNumber: 1, startColumn: 3, endLineNumber: 1, endColumn: 10 }
    })
  })

  test('the list’s shared defaults fill in what an item leaves out, and an item’s own values win', () => {
    const defaults = { commitCharacters: ['.'], editRange: range(4, 0, 4, 3), insertTextFormat: 2, insertTextMode: 1, data: { file: 'a.ts' } }
    const fromDefaults = toCompletionItem({ label: 'log', textEditText: 'log($1)' }, defaults, WORD)
    expect(fromDefaults.range).toEqual({ startLineNumber: 5, startColumn: 1, endLineNumber: 5, endColumn: 4 })
    expect(fromDefaults.insertText).toBe('log($1)')
    expect(fromDefaults.insertTextRules).toBe(enums.CompletionItemInsertTextRule.InsertAsSnippet | enums.CompletionItemInsertTextRule.KeepWhitespace)
    expect(fromDefaults.commitCharacters).toEqual(['.'])
    const own = toCompletionItem({ label: 'log', insertTextFormat: 1, insertTextMode: 2, commitCharacters: ['('], textEdit: { range: range(0, 0, 0, 0), newText: 'log' } }, defaults, WORD)
    expect(own.insertTextRules).toBeUndefined()
    expect(own.commitCharacters).toEqual(['('])
    expect(own.range).toEqual({ startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 })
    // Resolving sends the item back with the shared data it was listed under.
    expect(withDefaultData({ label: 'log' }, defaults).data).toEqual({ file: 'a.ts' })
    expect(withDefaultData({ label: 'log', data: 7 }, defaults).data).toBe(7)
  })

  test('label details, deprecation, documentation, extra edits and commands', () => {
    const item: LspCompletionItem = {
      label: 'readFile',
      labelDetails: { detail: '(path)', description: 'node:fs' },
      tags: [1],
      documentation: { kind: 'markdown', value: '**Reads** a file' },
      additionalTextEdits: [{ range: range(0, 0, 0, 0), newText: "import { readFile } from 'node:fs'\n" }],
      command: { title: 'Suggest', command: 'editor.action.triggerSuggest' }
    }
    const converted = toCompletionItem(item, undefined, WORD, (command) => ({ id: command.command, title: command.title }))
    expect(converted.label).toEqual({ label: 'readFile', detail: '(path)', description: 'node:fs' })
    expect(converted.tags).toEqual([enums.CompletionItemTag.Deprecated])
    expect(converted.documentation).toEqual({ value: '**Reads** a file' })
    expect(converted.additionalTextEdits).toEqual([{ range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 }, text: "import { readFile } from 'node:fs'\n" }])
    expect(converted.command).toEqual({ id: 'editor.action.triggerSuggest', title: 'Suggest' })
    // A command the editor cannot run is left off rather than failing when the item is accepted.
    expect(toCompletionItem(item, undefined, WORD).command).toBeUndefined()
    expect(toCompletionItem({ label: 'x', deprecated: true, documentation: 'plain' }, undefined, WORD)).toMatchObject({ tags: [1], documentation: 'plain' })
  })
})

describe('incremental document changes', () => {
  /** What a server does with `contentChanges`: applies each to the result of the one before. */
  function applySequentially(text: string, changes: { range: ReturnType<typeof range>; text: string }[]): string {
    for (const change of changes) text = applyTextEdits(text, [{ range: change.range, newText: change.text }])
    return text
  }
  const change = (sl: number, sc: number, el: number, ec: number, text: string, rangeLength = 0) => ({
    range: { startLineNumber: sl, startColumn: sc, endLineNumber: el, endColumn: ec },
    rangeOffset: 0,
    rangeLength,
    text
  })

  test('one typed character', () => {
    expect(toLspContentChanges([change(2, 4, 2, 4, 'x')])).toEqual([{ range: range(1, 3, 1, 3), rangeLength: 0, text: 'x' }])
  })

  test('a multi-cursor edit, whose ranges all refer to the old text, applies correctly one after another', () => {
    const before = 'let a = 1\nlet b = 2\nlet c = 3'
    // Monaco may report these in any order; "let" → "const" on every line.
    const changes = [change(1, 1, 1, 4, 'const', 3), change(3, 1, 3, 4, 'const', 3), change(2, 1, 2, 4, 'const', 3)]
    const sent = toLspContentChanges(changes)
    expect(sent.map((c) => c.range.start.line)).toEqual([2, 1, 0])
    expect(applySequentially(before, sent)).toBe('const a = 1\nconst b = 2\nconst c = 3')
  })

  test('two edits on one line go right to left', () => {
    const sent = toLspContentChanges([change(1, 1, 1, 1, '('), change(1, 4, 1, 4, ')')])
    expect(applySequentially('abc', sent)).toBe('(abc)')
  })

  test('a replacement that adds lines', () => {
    const sent = toLspContentChanges([change(1, 3, 2, 2, 'X\nY\nZ', 4)])
    expect(applySequentially('ab12\n3cd', sent)).toBe('abX\nY\nZcd')
  })
})

describe('text edits on a file that is not open', () => {
  const edit = (sl: number, sc: number, el: number, ec: number, newText: string): LspTextEdit => ({ range: range(sl, sc, el, ec), newText })

  test('edits in any order, all against the original text', () => {
    expect(applyTextEdits('one two three\nfour', [edit(1, 0, 1, 4, 'FOUR'), edit(0, 4, 0, 7, 'TWO'), edit(0, 0, 0, 0, '> ')])).toBe('> one TWO three\nFOUR')
  })

  test('inserts at the same place land in the order given', () => {
    expect(applyTextEdits('x', [edit(0, 0, 0, 0, 'a'), edit(0, 0, 0, 0, 'b')])).toBe('abx')
  })

  test('CRLF files keep their line ends, and a column past the end of a line stops before the break', () => {
    expect(applyTextEdits('ab\r\ncd\r\n', [edit(1, 0, 1, 2, 'CD')])).toBe('ab\r\nCD\r\n')
    expect(applyTextEdits('ab\r\ncd', [edit(0, 99, 0, 99, '!')])).toBe('ab!\r\ncd')
    expect(applyTextEdits('ab\ncd', [edit(5, 0, 5, 0, '\nend')])).toBe('ab\ncd\nend')
  })

  test('columns are UTF-16 units, as servers were told', () => {
    expect(applyTextEdits('𝒳 = 1', [edit(0, 2, 0, 2, '!')])).toBe('𝒳! = 1')
    expect(applyTextEdits('日本語 = 1', [edit(0, 0, 0, 3, 'name')])).toBe('name = 1')
  })

  test('overlapping edits are refused rather than guessed at', () => {
    expect(() => applyTextEdits('abcdef', [edit(0, 0, 0, 4, 'x'), edit(0, 2, 0, 5, 'y')])).toThrow(/Overlapping/)
  })

  test('a single text edit for Monaco', () => {
    expect(toTextEdit(edit(0, 1, 2, 3, 'new'))).toEqual({ range: { startLineNumber: 1, startColumn: 2, endLineNumber: 3, endColumn: 4 }, text: 'new' })
  })
})

describe('workspace edits', () => {
  const a = lspDocumentUri('ws', 'src/a.ts')
  const b = lspDocumentUri('ws', 'src/b.ts')

  test('`changes` becomes one step per file', () => {
    expect(workspaceEditSteps({ changes: { [a]: [{ range: range(0, 0, 0, 1), newText: 'x' }], [b]: [] } })).toEqual([
      { kind: 'edit', uri: a, edits: [{ range: range(0, 0, 0, 1), newText: 'x' }] },
      { kind: 'edit', uri: b, edits: [] }
    ])
  })

  test('`documentChanges` wins and keeps its order, file operations included', () => {
    const steps = workspaceEditSteps({
      changes: { [a]: [{ range: range(9, 9, 9, 9), newText: 'ignored' }] },
      documentChanges: [
        { kind: 'create', uri: b, options: { ignoreIfExists: true } },
        { textDocument: { uri: b, version: null }, edits: [{ range: range(0, 0, 0, 0), newText: 'export {}' }] },
        { kind: 'rename', oldUri: a, newUri: lspDocumentUri('ws', 'src/c.ts') },
        { kind: 'delete', uri: b }
      ]
    })
    expect(steps.map((s) => s.kind)).toEqual(['create', 'edit', 'rename', 'delete'])
    expect(steps[1]).toEqual({ kind: 'edit', uri: b, edits: [{ range: range(0, 0, 0, 0), newText: 'export {}' }] })
  })

  test('an empty edit is no steps', () => {
    expect(workspaceEditSteps({})).toEqual([])
  })
})

describe('document URIs', () => {
  test('a workspace path round-trips through its window URI', () => {
    for (const path of ['src/a.ts', 'my dir/файл #1.py', 'a%20b/c(1).rs', "it's.go"]) {
      const uri = lspDocumentUri('ws-1', path)
      expect(uri.startsWith('file:///__harness/ws-1/')).toBe(true)
      expect(uri).not.toMatch(/[ #()']/)
      expect(parseLspDocumentUri(uri)).toEqual({ workspaceId: 'ws-1', path })
    }
    expect(lspDocumentUri('ws', 'src/a b.ts')).toBe('file:///__harness/ws/src/a%20b.ts')
  })

  test('other URIs are not workspace files', () => {
    expect(parseLspDocumentUri('file:///__harness-external/ws/usr/lib/x.py')).toBeNull()
    expect(parseLspDocumentUri('file:///c%3A/dev/a.ts')).toBeNull()
    expect(parseLspDocumentUri('inmemory://model/1')).toBeNull()
  })
})

describe('diagnostics', () => {
  test('a diagnostic becomes a marker, with its code link, tags and related places', () => {
    const marker = toMarker(
      {
        range: range(4, 2, 4, 9),
        severity: 2,
        code: 'no-unused-vars',
        codeDescription: { href: 'https://eslint.org/docs/rules/no-unused-vars' },
        message: "'x' is defined but never used",
        tags: [1],
        relatedInformation: [{ location: { uri: lspDocumentUri('ws', 'b.ts'), range: range(0, 0, 0, 1) }, message: 'declared here' }]
      },
      'ESLint',
      parseUri
    )
    expect(marker).toEqual({
      startLineNumber: 5,
      startColumn: 3,
      endLineNumber: 5,
      endColumn: 10,
      severity: enums.MarkerSeverity.Warning,
      message: "'x' is defined but never used",
      source: 'ESLint',
      code: { value: 'no-unused-vars', target: { wire: 'https://eslint.org/docs/rules/no-unused-vars' } },
      tags: [enums.MarkerTag.Unnecessary],
      relatedInformation: [{ resource: { wire: 'file:///__harness/ws/b.ts' }, message: 'declared here', startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 2 }]
    } as never)
  })

  test('severity defaults to error, numeric codes become text, and the diagnostic’s own source wins', () => {
    const marker = toMarker({ range: range(0, 0, 0, 1), code: 2322, source: 'ts', message: 'm' }, 'TypeScript', parseUri)
    expect(marker).toMatchObject({ severity: enums.MarkerSeverity.Error, code: '2322', source: 'ts' })
    expect([1, 2, 3, 4].map((severity) => toMarker({ range: range(0, 0, 0, 0), severity, message: '' }, 's', parseUri).severity)).toEqual([
      enums.MarkerSeverity.Error,
      enums.MarkerSeverity.Warning,
      enums.MarkerSeverity.Info,
      enums.MarkerSeverity.Hint
    ])
  })

  test('markers under the cursor are matched back to the server’s diagnostics, data and all', () => {
    const known = [
      { range: range(1, 0, 1, 4), message: 'first', data: { fix: 1 } },
      { range: range(1, 0, 1, 4), message: 'second' },
      { range: range(7, 0, 7, 1), message: 'first' }
    ]
    const marker = { ...toMonacoRange(range(1, 0, 1, 4)), message: 'first', severity: 8 }
    expect(diagnosticsForMarkers([marker], known)).toEqual([known[0]!])
    expect(diagnosticsForMarkers([], known)).toEqual([])
  })
})

describe('hover, signature help, navigation, outline', () => {
  test('hover text in each of its forms', () => {
    expect(toHover({ contents: { kind: 'markdown', value: '**bold**' }, range: range(0, 0, 0, 3) })).toEqual({
      contents: [{ value: '**bold**' }],
      range: { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 4 }
    })
    expect(toHover({ contents: ['plain *markdown* string', { language: 'ts', value: 'const x: number' }, ''] }).contents).toEqual([{ value: 'plain *markdown* string' }, { value: '```ts\nconst x: number\n```' }])
    // Plain text must not turn into formatting.
    expect(toMarkdown({ kind: 'plaintext', value: 'a_b * c\n<tag>' }).value).toBe('a\\_b \\* c  \n\\<tag\\>')
  })

  test('signature help with label offsets and the active parameter', () => {
    const help = toSignatureHelp({
      signatures: [
        { label: 'f(a: string, b: number): void', documentation: { kind: 'markdown', value: 'docs' }, parameters: [{ label: [2, 11] }, { label: 'b: number', documentation: 'second' }], activeParameter: 1 },
        { label: 'f(): void' }
      ],
      activeSignature: 0,
      activeParameter: 0
    })
    expect(help.activeSignature).toBe(0)
    // The signature's own active parameter wins over the shared one.
    expect(help.activeParameter).toBe(1)
    expect(help.signatures[0]).toEqual({ label: 'f(a: string, b: number): void', documentation: { value: 'docs' }, parameters: [{ label: [2, 11] }, { label: 'b: number', documentation: 'second' }], activeParameter: 1 })
    expect(help.signatures[1]).toEqual({ label: 'f(): void', parameters: [] })
    expect(toSignatureHelp({ signatures: [{ label: 'g()' }] })).toMatchObject({ activeSignature: 0, activeParameter: 0 })
  })

  test('locations in every shape a server may answer with', () => {
    const a = lspDocumentUri('ws', 'a.ts')
    const one = { uri: a, range: range(1, 2, 1, 5) }
    const expected = { uri: { wire: a }, range: { startLineNumber: 2, startColumn: 3, endLineNumber: 2, endColumn: 6 } }
    expect(toLocations(one, parseUri)).toEqual([expected] as never)
    expect(toLocations([one, one], parseUri)).toEqual([expected, expected] as never)
    expect(toLocations(null, parseUri)).toEqual([])
    expect(toLocations([{ targetUri: a, targetRange: range(0, 0, 9, 0), targetSelectionRange: range(1, 2, 1, 5), originSelectionRange: range(4, 0, 4, 3) }], parseUri)).toEqual([
      {
        uri: { wire: a },
        range: { startLineNumber: 1, startColumn: 1, endLineNumber: 10, endColumn: 1 },
        targetSelectionRange: { startLineNumber: 2, startColumn: 3, endLineNumber: 2, endColumn: 6 },
        originSelectionRange: { startLineNumber: 5, startColumn: 1, endLineNumber: 5, endColumn: 4 }
      }
    ] as never)
    expect(locationUris([one, { uri: lspDocumentUri('ws', 'b.ts'), range: range(0, 0, 0, 0) }, one])).toEqual([a, lspDocumentUri('ws', 'b.ts')])
  })

  test('an outline from a symbol tree or from the older flat list', () => {
    const tree = toDocumentSymbols([{ name: 'Reader', detail: 'class', kind: 5, range: range(0, 0, 9, 1), selectionRange: range(0, 6, 0, 12), children: [{ name: 'push', kind: 6, tags: [1], range: range(1, 2, 3, 3), selectionRange: range(1, 2, 1, 6) }] }])
    expect(tree[0]).toMatchObject({ name: 'Reader', detail: 'class', kind: enums.SymbolKind.Class, tags: [] })
    expect(tree[0]!.children![0]).toMatchObject({ name: 'push', kind: enums.SymbolKind.Method, tags: [enums.SymbolTag.Deprecated], selectionRange: { startLineNumber: 2, startColumn: 3, endLineNumber: 2, endColumn: 7 } })
    const flat = toDocumentSymbols([{ name: 'main', kind: 12, location: { uri: 'file:///x', range: range(4, 0, 6, 1) }, containerName: 'app' }])
    expect(flat[0]).toEqual({ name: 'main', detail: '', kind: enums.SymbolKind.Function, tags: [], containerName: 'app', range: { startLineNumber: 5, startColumn: 1, endLineNumber: 7, endColumn: 2 }, selectionRange: { startLineNumber: 5, startColumn: 1, endLineNumber: 7, endColumn: 2 } })
  })
})
