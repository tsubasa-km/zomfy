import { describe, expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { compactIconRules, fileIconName, folderIconName, type IconThemeManifest } from '../src/lib/file-icons/icon-rules'

const require = createRequire(import.meta.url)
const { generateManifest } = require('material-icon-theme') as { generateManifest: () => IconThemeManifest }
const rules = compactIconRules(generateManifest())
const iconsDir = join(dirname(require.resolve('material-icon-theme/package.json')), 'icons')

describe('file icons', () => {
  test('goes by the whole name before the extension', () => {
    expect(fileIconName(rules, 'package.json')).toBe('nodejs')
    expect(fileIconName(rules, 'data.json')).toBe('json')
    expect(fileIconName(rules, 'src/Dockerfile')).toBe('docker')
  })

  test('tries the longest extension first', () => {
    expect(fileIconName(rules, 'main.ts')).toBe('typescript')
    expect(fileIconName(rules, 'types.d.ts')).toBe('typescript-def')
    expect(fileIconName(rules, 'App.TSX')).toBe('react_ts')
  })

  test('falls back to the plain file', () => {
    expect(fileIconName(rules, 'notes.unheard-of')).toBe('file')
    expect(fileIconName(rules, 'constructor')).toBe('file')
  })

  test('has light variants', () => {
    expect(fileIconName(rules, 'Cargo.toml')).toBe('toml')
    expect(fileIconName(rules, 'Cargo.toml', { light: true })).toBe('toml_light')
  })
})

describe('folder icons', () => {
  test('goes by the name, whatever decorates it', () => {
    expect(folderIconName(rules, 'src')).toBe('folder-src')
    expect(folderIconName(rules, 'packages/app/src', { open: true })).toBe('folder-src-open')
    expect(folderIconName(rules, '__tests__')).toBe(folderIconName(rules, 'tests'))
    expect(folderIconName(rules, '.github')).toBe('folder-github')
  })

  test('knows a few folders by where they are', () => {
    expect(folderIconName(rules, '.github/workflows')).toBe('folder-gh-workflows')
  })

  test('falls back to the plain folder and the root', () => {
    expect(folderIconName(rules, 'zzz-nothing')).toBe('folder')
    expect(folderIconName(rules, 'zzz-nothing', { open: true })).toBe('folder-open')
    expect(folderIconName(rules, 'anything', { root: true })).toBe('folder-root')
  })

  test('every icon the rules name is a file in the theme', () => {
    const named = new Set([rules.file, rules.folder, rules.folderOpen, rules.root, rules.rootOpen, ...Object.values(rules.names), ...Object.values(rules.exts), ...Object.values(rules.light.names), ...Object.values(rules.light.exts)])
    for (const closed of [...Object.values(rules.folders), ...Object.values(rules.light.folders)]) {
      named.add(closed)
      named.add(rules.opened[closed] ?? `${closed}-open`)
    }
    const missing = [...named].filter((name) => !existsSync(join(iconsDir, `${name}.svg`)))
    expect(missing).toEqual([])
  })
})
