// Compiles the daemon for each target, replacing dist/ files only when the bytes changed. The
// desktop app restarts a running daemon when its binary's size+mtime stamp changes, so an
// unchanged rebuild must leave the file (and the user's terminals) alone.
import { mkdir, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'

const targets: Record<string, string> = {
  'bun-windows-x64': 'acp-harness-daemon-windows-x64.exe',
  'bun-linux-x64': 'acp-harness-daemon-linux-x64'
}
const wanted = process.argv.slice(2)
const root = join(import.meta.dir, '..')
const dist = join(root, 'dist')
await mkdir(dist, { recursive: true })

for (const [target, name] of Object.entries(targets)) {
  if (wanted.length > 0 && !wanted.includes(target)) continue
  const out = join(dist, name)
  // Keeps the target extension: bun appends .exe to a Windows outfile that lacks it.
  const temp = join(dist, `.building-${name}`)
  const build = Bun.spawnSync(
    ['bun', 'build', '--compile', `--target=${target}`, join(root, 'src', 'main.ts'), '--outfile', temp],
    { stdout: 'inherit', stderr: 'inherit' }
  )
  if (build.exitCode !== 0) process.exit(build.exitCode ?? 1)
  const fresh = Bun.file(temp)
  const current = Bun.file(out)
  const same =
    (await current.exists()) &&
    current.size === fresh.size &&
    Bun.hash(await current.arrayBuffer()) === Bun.hash(await fresh.arrayBuffer())
  if (same) {
    await rm(temp)
    console.log(`${name}: unchanged`)
  } else {
    await rename(temp, out)
    console.log(`${name}: updated`)
  }
}
