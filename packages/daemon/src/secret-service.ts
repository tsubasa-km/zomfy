import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { isChatAgentId, type ChatAgentId, type SecretInfo, type SecretSaveParams } from '@zomfy/protocol'
import { HARNESS_HOME } from './harness-home.ts'
import { bunKeyring, type Keyring } from './hosting-token-store.ts'
import { log, setLogFilter } from './log.ts'
import { secretRedactor, type SecretRedactor } from './secret-redaction.ts'

// Secrets agents get as environment variables (docs/specs/agent-secrets.md). The list lives in
// ~/.zomfy/secrets.json without values; values go to the OS credential store (the GitLab tokens'
// store, service `zomfy-secrets`), or into that owner-only file on a host without one. Values are
// held in memory to pass to agents and to redact, and never go to a client.

const SERVICE = 'zomfy-secrets'
const VARIABLE = /^[A-Za-z_][A-Za-z0-9_]*$/

interface StoredSecret extends SecretInfo {
  /** Only when `storage` is 'file'. */
  value?: string
}

interface StoreFile {
  secrets: StoredSecret[]
}

/** The fields a secret saved with the removed tunnel carried; dropped when the list loads. */
const TUNNEL_FIELDS = ['exposure', 'upstream', 'baseUrlVariable'] as const

/** A saved secret as this daemon keeps it; a tunnel secret becomes an environment one. */
function migrated(raw: StoredSecret): { secret: StoredSecret; changed: boolean } {
  const record = raw as StoredSecret & Partial<Record<(typeof TUNNEL_FIELDS)[number], unknown>>
  if (!TUNNEL_FIELDS.some((field) => field in record)) return { secret: raw, changed: false }
  const { exposure: _exposure, upstream: _upstream, baseUrlVariable: _baseUrlVariable, ...secret } = record
  return { secret, changed: true }
}

const keyOf = (id: string) => `secret:${id}`

export interface SecretServiceDeps {
  path: string
  keyring: Keyring
  redactor: SecretRedactor
  now?: () => Date
}

export class SecretService {
  private secrets: StoredSecret[] = []
  private readonly values = new Map<string, string>()
  private loaded: Promise<void> | null = null
  private writing = Promise.resolve()

  constructor(private readonly deps: SecretServiceDeps) {}

  private load(): Promise<void> {
    this.loaded ??= (async () => {
      const loaded = (await this.readFile()).secrets.map(migrated)
      this.secrets = loaded.map((l) => l.secret)
      if (loaded.some((l) => l.changed)) {
        await this.writeFile().catch((error: unknown) => log(`rewriting ${this.deps.path} without tunnel fields failed: ${String(error)}`))
      }
      await Promise.all(
        this.secrets.map(async (secret) => {
          const value = secret.storage === 'file' ? secret.value : await this.deps.keyring.get(keyOf(secret.id)).catch((error: unknown) => {
            log(`the credential store did not give the value of ${secret.name}: ${String(error)}`)
            return null
          })
          if (value) this.values.set(secret.id, value)
        })
      )
      this.refreshRedactor()
    })()
    return this.loaded
  }

  private async readFile(): Promise<StoreFile> {
    try {
      const parsed = JSON.parse(await readFile(this.deps.path, 'utf8')) as Partial<StoreFile>
      return { secrets: Array.isArray(parsed.secrets) ? parsed.secrets : [] }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') log(`${this.deps.path} unreadable: ${String(error)}`)
      return { secrets: [] }
    }
  }

  private async writeFile(): Promise<void> {
    await mkdir(dirname(this.deps.path), { recursive: true })
    const temporary = `${this.deps.path}.${crypto.randomUUID()}.tmp`
    try {
      await writeFile(temporary, JSON.stringify({ secrets: this.secrets } satisfies StoreFile, null, 2), { mode: 0o600 })
      await rename(temporary, this.deps.path)
    } finally {
      await rm(temporary, { force: true }).catch(() => undefined)
    }
  }

  private serial<T>(work: () => Promise<T>): Promise<T> {
    const next = this.writing.then(() => this.load()).then(work)
    this.writing = next.then(
      () => undefined,
      () => undefined
    )
    return next
  }

  private refreshRedactor(): void {
    this.deps.redactor.set(this.secrets.flatMap((s) => (this.values.has(s.id) ? [{ name: s.name, value: this.values.get(s.id)! }] : [])))
  }

  /** The secrets without their values. */
  async list(): Promise<SecretInfo[]> {
    await this.load()
    return this.secrets.map(({ value: _value, ...info }) => info)
  }

  save(params: SecretSaveParams): Promise<SecretInfo[]> {
    return this.serial(async () => {
      const existing = params.id ? this.secrets.find((s) => s.id === params.id) : undefined
      if (params.id && !existing) throw new Error('That secret no longer exists')
      const name = params.name?.trim() ?? ''
      if (!VARIABLE.test(name)) throw new Error(`${name || 'An empty name'} is not a variable name`)
      if (this.secrets.some((s) => s.id !== existing?.id && s.name.toUpperCase() === name.toUpperCase())) throw new Error(`A secret named ${name} exists`)
      const value = params.value?.trim()
      if (!existing && !value) throw new Error('Enter the value')
      const id = existing?.id ?? crypto.randomUUID()
      let storage: 'keyring' | 'file' = existing?.storage ?? 'keyring'
      let fileValue = existing?.value
      if (value) {
        try {
          await this.deps.keyring.set(keyOf(id), value)
          storage = 'keyring'
          fileValue = undefined
        } catch (error) {
          log(`no credential store on this host (${String(error)}); the value of ${name} goes to ${this.deps.path}`)
          storage = 'file'
          fileValue = value
        }
      }
      const secret: StoredSecret = {
        id,
        name,
        agents: [...new Set((params.agents ?? []).filter(isChatAgentId))],
        projectIds: [...new Set((params.projectIds ?? []).filter((p) => typeof p === 'string' && p))],
        storage,
        updatedAt: (this.deps.now ?? (() => new Date()))().toISOString(),
        ...(storage === 'file' && fileValue ? { value: fileValue } : {})
      }
      const previous = this.secrets
      this.secrets = existing ? this.secrets.map((s) => (s.id === id ? secret : s)) : [...this.secrets, secret]
      try {
        await this.writeFile()
      } catch (error) {
        this.secrets = previous
        throw error
      }
      if (value) this.values.set(id, value)
      this.refreshRedactor()
      return this.list()
    })
  }

  delete(id: string): Promise<SecretInfo[]> {
    return this.serial(async () => {
      const secret = this.secrets.find((s) => s.id === id)
      if (!secret) return this.list()
      if (secret.storage === 'keyring') {
        await this.deps.keyring.delete(keyOf(id)).catch((error: unknown) => log(`removing ${secret.name} from the credential store failed: ${String(error)}`))
      }
      this.secrets = this.secrets.filter((s) => s.id !== id)
      this.values.delete(id)
      await this.writeFile()
      this.refreshRedactor()
      return this.list()
    })
  }

  /**
   * The variables a chat's agent process starts with: each secret that applies, with its value. The
   * agent can read them; redaction keeps them out of what Zomfy shows. `projectId` null is a chat
   * outside a project.
   */
  async envFor(agent: ChatAgentId, projectId: string | null): Promise<Record<string, string>> {
    await this.load()
    const env: Record<string, string> = {}
    for (const secret of this.secrets) {
      if (secret.agents.length && !secret.agents.includes(agent)) continue
      if (secret.projectIds.length && (!projectId || !secret.projectIds.includes(projectId))) continue
      const value = this.values.get(secret.id)
      if (value) env[secret.name] = value
    }
    return env
  }
}

let service: SecretService | null = null

/** This host's secrets; redacts the daemon's log once loaded. */
export function secrets(): SecretService {
  if (!service) {
    service = new SecretService({ path: join(HARNESS_HOME, 'secrets.json'), keyring: bunKeyring(SERVICE), redactor: secretRedactor })
    setLogFilter((message) => secretRedactor.text(message))
    void service.list().catch((error: unknown) => log(`loading secrets failed: ${String(error)}`))
  }
  return service
}
