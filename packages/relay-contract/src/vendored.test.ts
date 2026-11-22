import { expect, test } from 'bun:test'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { CONTRACT_SRC, contractFiles, VENDOR_NOTE, VENDORED } from '../../../scripts/relay-vendor'

function vendoredFiles(dir = VENDORED): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) out.push(...vendoredFiles(path))
    else out.push(relative(VENDORED, path).split(sep).join('/'))
  }
  return out.sort()
}

const normal = (text: string) => text.replace(/\r\n/g, '\n')

test('apps/relay/src/contract is an exact copy of this package (run `bun run relay:vendor`)', () => {
  expect(existsSync(VENDORED)).toBe(true)
  expect(vendoredFiles().filter((f) => f !== VENDOR_NOTE)).toEqual(contractFiles())
  for (const file of contractFiles()) {
    expect({ file, text: normal(readFileSync(join(VENDORED, file), 'utf8')) }).toEqual({
      file,
      text: normal(readFileSync(join(CONTRACT_SRC, file), 'utf8'))
    })
  }
})
