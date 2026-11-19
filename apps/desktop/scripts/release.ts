// Publishes a Zomfy release the installed app updates itself from (plugins.updater in tauri.conf.json):
// bumps the version on development, builds the signed Windows installer, and brings development into
// main through a pull request merged with a merge commit once CI passes on it (main takes no pushes;
// see AGENTS.md). Then it tags that merge, uploads the installer with latest.json to a GitHub
// Release of tsubasa-km/zomfy, and moves development up to it so the next release's notes start there.
//
//   bun scripts/release.ts [patch|minor|major|<x.y.z>] [--skip-checks]   (default: patch)
//
// It first runs the typecheck and both test suites, as CI does; --skip-checks is for emergencies.
//
// Signs with ~/.ssh/zomfy-updater.key (or TAURI_SIGNING_PRIVATE_KEY); losing that key strands installed copies.
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const REPO = 'tsubasa-km/zomfy'
const REMOTE = 'github'
const desktop = join(import.meta.dir, '..')
const root = join(desktop, '..', '..')
const confPath = join(desktop, 'src-tauri', 'tauri.conf.json')
const cargoPath = join(desktop, 'src-tauri', 'Cargo.toml')
const pkgPath = join(desktop, 'package.json')

function run(cmd: string[], opts: { cwd?: string; env?: Record<string, string>; quiet?: boolean } = {}): string {
  const result = Bun.spawnSync(cmd, {
    cwd: opts.cwd ?? root,
    env: { ...process.env, ...opts.env },
    stdout: opts.quiet ? 'pipe' : 'inherit',
    stderr: 'inherit'
  })
  if (result.exitCode !== 0) throw new Error(`${cmd.join(' ')} exited with ${result.exitCode}`)
  return result.stdout?.toString().trim() ?? ''
}

/** Waits for the pull request's checks, which take a moment to appear; throws when one fails. */
function waitForChecks(pr: string, env: Record<string, string>): void {
  for (let attempt = 0; attempt < 30; attempt++) {
    Bun.sleepSync(10_000)
    const listed = Bun.spawnSync(['gh', 'pr', 'checks', pr, '--repo', REPO], { cwd: root, env: { ...process.env, ...env } })
    if (listed.stdout.toString().trim()) break
  }
  run(['gh', 'pr', 'checks', pr, '--repo', REPO, '--watch', '--fail-fast', '--interval', '20'], { env })
}

function nextVersion(current: string, how: string): string {
  if (/^\d+\.\d+\.\d+$/.test(how)) return how
  const [major, minor, patch] = current.split('.').map(Number)
  if (how === 'major') return `${major + 1}.0.0`
  if (how === 'minor') return `${major}.${minor + 1}.0`
  if (how === 'patch') return `${major}.${minor}.${patch + 1}`
  throw new Error(`Unknown bump "${how}": use patch, minor, major or x.y.z`)
}

if (run(['git', 'status', '--porcelain'], { quiet: true })) throw new Error('Commit or stash your changes first.')
if (run(['git', 'branch', '--show-current'], { quiet: true }) !== 'development') throw new Error('Release from development.')
run(['git', 'fetch', REMOTE, 'main', 'development'], { quiet: true })
if (run(['git', 'rev-parse', 'HEAD'], { quiet: true }) !== run(['git', 'rev-parse', `${REMOTE}/development`], { quiet: true })) {
  throw new Error(`development differs from ${REMOTE}/development: push or pull it first.`)
}

const keyPath = join(homedir(), '.ssh', 'zomfy-updater.key')
const signingKey = process.env.TAURI_SIGNING_PRIVATE_KEY ?? (existsSync(keyPath) ? keyPath : null)
if (!signingKey) throw new Error(`No signing key: ${keyPath} is missing and TAURI_SIGNING_PRIVATE_KEY is unset.`)
// The fork's owner account, without switching gh's active account.
const token = run(['gh', 'auth', 'token', '--user', 'tsubasa-km'], { quiet: true })

// The same checks as CI (.github/workflows/ci.yml): a release never ships what they would refuse.
if (!process.argv.includes('--skip-checks')) {
  run(['bun', 'run', 'typecheck'])
  run(['bun', 'test'], { cwd: join(root, 'packages', 'daemon') })
  run(['bun', 'test'], { cwd: desktop })
}

const conf = JSON.parse(readFileSync(confPath, 'utf8'))
const previous: string = conf.version
const bump = process.argv.slice(2).find((arg) => !arg.startsWith('--'))
const version = nextVersion(previous, bump ?? 'patch')
const tag = `v${version}`
conf.version = version
writeFileSync(confPath, `${JSON.stringify(conf, null, 2)}\n`)
writeFileSync(cargoPath, readFileSync(cargoPath, 'utf8').replace(/^version = ".*"$/m, `version = "${version}"`))
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
pkg.version = version
writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`)
// bun.lock records each workspace's version: without this the next `bun install` rewrites it.
run(['bun', 'install'], { quiet: true })

run(['bun', 'run', 'tauri', 'build'], {
  cwd: desktop,
  env: { TAURI_SIGNING_PRIVATE_KEY: signingKey, TAURI_SIGNING_PRIVATE_KEY_PASSWORD: process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD ?? '' }
})

const installerName = `Zomfy_${version}_x64-setup.exe`
const installer = join(desktop, 'src-tauri', 'target', 'release', 'bundle', 'nsis', installerName)
const signature = readFileSync(`${installer}.sig`, 'utf8').trim()
const lastTag = Bun.spawnSync(['git', 'describe', '--tags', '--abbrev=0'], { cwd: root }).stdout.toString().trim()
const log = run(['git', 'log', '--no-merges', '--format=- %s', ...(lastTag ? [`${lastTag}..HEAD`] : ['-20'])], { quiet: true })
const notes = log || '- Maintenance'
const latestPath = join(desktop, 'src-tauri', 'target', 'release', 'bundle', 'latest.json')
writeFileSync(
  latestPath,
  `${JSON.stringify(
    {
      version,
      notes,
      pub_date: new Date().toISOString(),
      platforms: {
        'windows-x86_64': { signature, url: `https://github.com/${REPO}/releases/download/${tag}/${installerName}` }
      }
    },
    null,
    2
  )}\n`
)

const gh = { GH_TOKEN: token }
run(['git', 'add', confPath, cargoPath, pkgPath, join(desktop, 'src-tauri', 'Cargo.lock'), join(root, 'bun.lock')])
run(['git', 'commit', '-m', `Release ${tag}`])
run(['git', 'push', REMOTE, 'development'], { env: gh })

// main changes only through a pull request; its required check is CI's.
const pr = run(['gh', 'pr', 'create', '--repo', REPO, '--base', 'main', '--head', 'development', '--title', `Release ${tag}`, '--body', notes], {
  env: gh,
  quiet: true
})
waitForChecks(pr, gh)
run(['gh', 'pr', 'merge', pr, '--repo', REPO, '--merge', '--subject', `Merge development for ${tag}`], { env: gh })

run(['git', 'fetch', REMOTE, 'main'], { quiet: true })
run(['git', 'tag', tag, `${REMOTE}/main`])
run(['git', 'push', REMOTE, tag], { env: gh })
run(['gh', 'release', 'create', tag, installer, `${installer}.sig`, latestPath, '--repo', REPO, '--title', `Zomfy ${version}`, '--notes', notes], { env: gh })
// development moves up to the merge, so the tag is in its history and the next notes start after it.
run(['git', 'merge', '--ff-only', `${REMOTE}/main`])
run(['git', 'push', REMOTE, 'development'], { env: gh })
// The local main follows the remote one; it is checked out nowhere, or this is skipped.
Bun.spawnSync(['git', 'branch', '-f', 'main', `${REMOTE}/main`], { cwd: root })
// Each release leaves a ~130 MB installer behind; once this one is uploaded the older ones are dead weight.
const nsisDir = join(desktop, 'src-tauri', 'target', 'release', 'bundle', 'nsis')
for (const name of readdirSync(nsisDir)) {
  if (name !== installerName && name !== `${installerName}.sig`) rmSync(join(nsisDir, name), { force: true })
}
console.log(`Released ${tag} (was ${previous}): ${installer}`)
