import { afterEach, describe, expect, test } from 'bun:test'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  LSP_SERVER_CATALOG,
  lspLanguageId,
  lspProjectRoot,
  lspRequirementMet,
  refreshLspServerProbes,
  resolveLspServer,
  splitCommand,
  type LspServerSpec
} from './lsp-server-catalog.ts'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  refreshLspServerProbes()
})

function workspace(): string {
  const dir = mkdtempSync(join(tmpdir(), 'lsp-catalog-'))
  dirs.push(dir)
  return dir
}

/** A command in the workspace's `node_modules/.bin` that prints `output` and exits with `code`. */
function tool(root: string, name: string, output: string, code = 0): void {
  const bin = join(root, 'node_modules', '.bin')
  mkdirSync(bin, { recursive: true })
  if (process.platform === 'win32') writeFileSync(join(bin, `${name}.cmd`), `@echo off\r\necho ${output}\r\nexit /b ${code}\r\n`)
  else {
    writeFileSync(join(bin, name), `#!/bin/sh\necho "${output}"\nexit ${code}\n`)
    chmodSync(join(bin, name), 0o755)
  }
}

const spec = (id: string) => LSP_SERVER_CATALOG.find((s) => s.id === id)!
const NOWHERE = 'zomfy-test-no-such-language-server'

describe('language server catalog', () => {
  test('the well-known languages each have a server, and Python a linter beside it', () => {
    const serving = (language: string) => LSP_SERVER_CATALOG.filter((s) => s.languages.includes(language)).map((s) => `${s.id}:${s.role}`)
    expect(serving('typescript')).toEqual(['typescript:primary', 'eslint:linter'])
    expect(serving('javascriptreact')).toEqual(['typescript:primary', 'eslint:linter'])
    expect(serving('python')).toEqual(['python:primary', 'ruff:linter'])
    expect(serving('rust')).toEqual(['rust:primary'])
    expect(serving('go')).toEqual(['go:primary'])
    expect(serving('cpp')).toEqual(['clangd:primary'])
    for (const server of LSP_SERVER_CATALOG) expect(server.install.length).toBeGreaterThan(0)
  })

  test('a file’s LSP language comes from its name, else from the editor', () => {
    expect(lspLanguageId('src/App.tsx', 'typescript')).toBe('typescriptreact')
    expect(lspLanguageId('src/a.MTS', 'typescript')).toBe('typescript')
    expect(lspLanguageId('x/index.jsx', 'javascript')).toBe('javascriptreact')
    expect(lspLanguageId('pkg/mod.pyi', 'python')).toBe('python')
    expect(lspLanguageId('go.mod', 'plaintext')).toBe('gomod')
    expect(lspLanguageId('include/a.hpp', 'cpp')).toBe('cpp')
    expect(lspLanguageId('Gemfile', 'ruby')).toBe('ruby')
    expect(lspLanguageId('a.zig', 'plaintext')).toBe('plaintext')
  })

  test('the project root is the workspace when it is a project, else the nearest marked folder above the file', () => {
    const root = workspace()
    mkdirSync(join(root, 'backend', 'src', 'deep'), { recursive: true })
    writeFileSync(join(root, 'backend', 'Cargo.toml'), '')
    expect(lspProjectRoot(spec('rust'), root, 'backend/src/deep/main.rs')).toBe(join(root, 'backend'))
    expect(lspProjectRoot(spec('rust'), root, 'other/main.rs')).toBe(root)
    writeFileSync(join(root, 'Cargo.toml'), '')
    expect(lspProjectRoot(spec('rust'), root, 'backend/src/deep/main.rs')).toBe(root)
  })

  test('ESLint only counts in a folder that configures it', () => {
    const root = workspace()
    expect(lspRequirementMet(spec('eslint'), root)).toBe(false)
    writeFileSync(join(root, 'package.json'), JSON.stringify({ eslintConfig: {} }))
    expect(lspRequirementMet(spec('eslint'), root)).toBe(true)
    const flat = workspace()
    writeFileSync(join(flat, 'eslint.config.mjs'), '')
    expect(lspRequirementMet(spec('eslint'), flat)).toBe(true)
    expect(lspRequirementMet(spec('rust'), root)).toBe(true)
  })

  test('a server in the workspace’s own tool folder is found, with its arguments', async () => {
    const root = workspace()
    tool(root, 'my-ls', 'my-ls 1.0')
    const custom: LspServerSpec = { id: 'x', name: 'X', role: 'primary', languages: ['x'], candidates: [{ command: NOWHERE, args: [] }, { command: 'my-ls', args: ['--stdio'] }], rootMarkers: [], install: 'install x' }
    const resolved = await resolveLspServer({ spec: custom, override: {} }, root)
    expect(resolved.status).toBe('ready')
    if (resolved.status !== 'ready') return
    expect(resolved.argv.at(-1)).toBe('--stdio')
    expect(resolved.argv.join(' ')).toContain('my-ls')
  })

  test('in a monorepo the tool beside the file’s own package is found', async () => {
    const root = workspace()
    mkdirSync(join(root, 'packages', 'app', 'src'), { recursive: true })
    tool(join(root, 'packages', 'app'), 'pkg-ls', 'pkg-ls 1.0')
    const custom: LspServerSpec = { id: 'x', name: 'X', role: 'primary', languages: ['x'], candidates: [{ command: 'pkg-ls', args: [], where: 'workspace' }], rootMarkers: [], install: 'install x' }
    expect((await resolveLspServer({ spec: custom, override: {} }, root, 'packages/app/src/a.x')).status).toBe('ready')
    expect((await resolveLspServer({ spec: custom, override: {} }, root, 'packages/other/a.x')).status).toBe('missing')
  })

  test('a command that is found but will not run counts as missing, with what it said', async () => {
    const root = workspace()
    // What rustup's `rust-analyzer` does until the component is added.
    tool(root, 'broken-ls', 'error: Unknown binary', 1)
    const broken: LspServerSpec = { id: 'x', name: 'X', role: 'primary', languages: ['x'], candidates: [{ command: 'broken-ls', args: [], probe: { args: ['--version'] } }], rootMarkers: [], install: 'install x' }
    const resolved = await resolveLspServer({ spec: broken, override: {} }, root)
    expect(resolved).toEqual({ status: 'missing', detail: '`broken-ls` is on PATH but does not run: error: Unknown binary' })
  })

  test('a workspace’s tsc is taken as the server only from TypeScript 7 on', async () => {
    const candidates = spec('typescript').candidates.filter((c) => c.command === 'tsc' && c.where === 'workspace')
    const only: LspServerSpec = { ...spec('typescript'), candidates }
    const old = workspace()
    tool(old, 'tsc', 'Version 5.9.2')
    expect((await resolveLspServer({ spec: only, override: {} }, old)).status).toBe('missing')
    refreshLspServerProbes()
    const native = workspace()
    tool(native, 'tsc', 'Version 7.0.2')
    const resolved = await resolveLspServer({ spec: only, override: {} }, native)
    expect(resolved.status).toBe('ready')
    if (resolved.status === 'ready') expect(resolved.argv.slice(-2)).toEqual(['--lsp', '--stdio'])
  })

  test('the person’s own command wins, and a missing one says so', async () => {
    const root = workspace()
    tool(root, 'my-ls', 'my-ls 1.0')
    const resolved = await resolveLspServer({ spec: spec('rust'), override: { command: 'my-ls --flag "two words"' } }, root)
    expect(resolved.status).toBe('ready')
    if (resolved.status === 'ready') expect(resolved.argv.slice(-2)).toEqual(['--flag', 'two words'])
    const missing = await resolveLspServer({ spec: spec('rust'), override: { command: `${NOWHERE} --stdio` } }, root)
    expect(missing).toEqual({ status: 'missing', detail: `\`${NOWHERE}\` (your command for rust-analyzer) is not on this host's PATH` })
    expect(splitCommand('a "b c" d')).toEqual(['a', 'b c', 'd'])
  })
})
