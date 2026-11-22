// Copies packages/relay-contract/src into apps/relay/src/contract, so the Worker builds on its own
// under the Deploy to Cloudflare button, which cannot resolve a `workspace:*` dependency.
// packages/relay-contract's tests fail when the copy differs (docs/specs/bots/contract.md).

import { cpSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

const root = join(import.meta.dir, '..')
export const CONTRACT_SRC = join(root, 'packages', 'relay-contract', 'src')
export const VENDORED = join(root, 'apps', 'relay', 'src', 'contract')
export const VENDOR_NOTE = 'README.md'

/** The files the copy holds: every source file but tests. */
export function contractFiles(dir = CONTRACT_SRC): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) out.push(...contractFiles(path))
    else if (name.endsWith('.ts') && !name.endsWith('.test.ts')) out.push(relative(CONTRACT_SRC, path).split(sep).join('/'))
  }
  return out.sort()
}

if (import.meta.main) {
  rmSync(VENDORED, { recursive: true, force: true })
  mkdirSync(VENDORED, { recursive: true })
  for (const file of contractFiles()) {
    mkdirSync(join(VENDORED, file, '..'), { recursive: true })
    cpSync(join(CONTRACT_SRC, file), join(VENDORED, file))
  }
  writeFileSync(
    join(VENDORED, VENDOR_NOTE),
    '# Vendored contract\n\nA copy of `packages/relay-contract/src`, made by `bun run relay:vendor`. Do not edit it here:\nchange the package and run the script again.\n'
  )
  console.log(`Copied ${contractFiles().length} files to ${relative(root, VENDORED)}`)
}
