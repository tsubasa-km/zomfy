// Publishes a Zomfy release the installed app updates itself from (plugins.updater in tauri.conf.json):
// bumps the version, builds the signed Windows installer, commits and tags, pushes, and uploads the
// installer with latest.json to a GitHub Release of tsubasa-km/zomfy.
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

function nextVersion(current: string, how: string): string {
  if (/^\d+\.\d+\.\d+$/.test(how)) return how
  const [major, minor, patch] = current.split('.').map(Number)
  if (how === 'major') return `${major + 1}.0.0`
  if (how === 'minor') return `${major}.${minor + 1}.0`
  if (how === 'patch') return `${major}.${minor}.${patch + 1}`
  throw new Error(`Unknown bump "${how}": use patch, minor, major or x.y.z`)
}

if (run(['git', 'status', '--porcelain'], { quiet: true })) throw new Error('Commit or stash your changes first.')
if (run(['git', 'branch', '--show-current'], { quiet: true }) !== 'main') throw new Error('Release from main.')

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
const log = run(['git', 'log', '--format=- %s', ...(lastTag ? [`${lastTag}..HEAD`] : ['-20'])], { quiet: true })
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

run(['git', 'add', confPath, cargoPath, pkgPath, join(desktop, 'src-tauri', 'Cargo.lock'), join(root, 'bun.lock')])
run(['git', 'commit', '-m', `Release ${tag}`])
run(['git', 'tag', tag])
run(['git', 'push', REMOTE, 'main', tag], { env: { GH_TOKEN: token } })
run(['gh', 'release', 'create', tag, installer, `${installer}.sig`, latestPath, '--repo', REPO, '--title', `Zomfy ${version}`, '--notes', notes], {
  env: { GH_TOKEN: token }
})
// Each release leaves a ~130 MB installer behind; once this one is uploaded the older ones are dead weight.
const nsisDir = join(desktop, 'src-tauri', 'target', 'release', 'bundle', 'nsis')
for (const name of readdirSync(nsisDir)) {
  if (name !== installerName && name !== `${installerName}.sig`) rmSync(join(nsisDir, name), { force: true })
}
console.log(`Released ${tag} (was ${previous}): ${installer}`)
