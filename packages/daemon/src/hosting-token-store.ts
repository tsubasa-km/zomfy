import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { HostingAccountRef } from '@zomfy/protocol'
import { log } from './log.ts'

// GitLab tokens Zomfy holds for a second account on a host glab already has one for
// (docs/specs/project-hosting-accounts.md). The token goes to the OS credential store; only the list
// of accounts is written to the file, unless the host has no credential store.

/** The OS credential store; swappable so tests never touch the person's keyring. */
export interface Keyring {
  get(name: string): Promise<string | null>
  set(name: string, value: string): Promise<void>
  delete(name: string): Promise<void>
}

const SERVICE = 'zomfy-hosting'

/** Bun.secrets: Windows Credential Manager, macOS Keychain, libsecret. */
export const osKeyring: Keyring = {
  get: (name) => Bun.secrets.get({ service: SERVICE, name }),
  set: (name, value) => Bun.secrets.set({ service: SERVICE, name, value }),
  delete: async (name) => {
    await Bun.secrets.delete({ service: SERVICE, name })
  }
}

export interface StoredAccount extends HostingAccountRef {
  storage: 'keyring' | 'file'
}

interface StoredEntry extends StoredAccount {
  /** Only when `storage` is 'file'. */
  token?: string
}

interface StoreFile {
  accounts: StoredEntry[]
}

const keyOf = (ref: HostingAccountRef) => `${ref.provider}:${ref.host.toLowerCase()}:${ref.login}`

export class HostingTokenStore {
  private writing = Promise.resolve()

  constructor(
    private readonly path: string,
    private readonly keyring: Keyring = osKeyring
  ) {}

  private async read(): Promise<StoreFile> {
    try {
      const parsed = JSON.parse(await readFile(this.path, 'utf8')) as Partial<StoreFile>
      return { accounts: Array.isArray(parsed.accounts) ? parsed.accounts : [] }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') log(`${this.path} unreadable: ${String(error)}`)
      return { accounts: [] }
    }
  }

  private async write(file: StoreFile): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true })
    const temporary = `${this.path}.${crypto.randomUUID()}.tmp`
    try {
      // Owner-only: it may hold a token when the host has no credential store.
      await writeFile(temporary, JSON.stringify(file, null, 2), { mode: 0o600 })
      await rename(temporary, this.path)
    } finally {
      await rm(temporary, { force: true }).catch(() => undefined)
    }
  }

  private serial<T>(work: () => Promise<T>): Promise<T> {
    const next = this.writing.then(work)
    this.writing = next.then(
      () => undefined,
      () => undefined
    )
    return next
  }

  /** The accounts without their tokens. */
  async list(): Promise<StoredAccount[]> {
    return (await this.read()).accounts.map(({ provider, host, login, storage }) => ({ provider, host, login, storage }))
  }

  async token(ref: HostingAccountRef): Promise<string | null> {
    const entry = (await this.read()).accounts.find((a) => keyOf(a) === keyOf(ref))
    if (!entry) return null
    if (entry.storage === 'file') return entry.token ?? null
    try {
      return await this.keyring.get(keyOf(ref))
    } catch (error) {
      log(`the credential store did not give the token for ${keyOf(ref)}: ${String(error)}`)
      return null
    }
  }

  /** Keeps the token, in the credential store when the host has one; says where it went. */
  save(ref: HostingAccountRef, token: string): Promise<'keyring' | 'file'> {
    return this.serial(async () => {
      const file = await this.read()
      let storage: 'keyring' | 'file' = 'keyring'
      try {
        await this.keyring.set(keyOf(ref), token)
      } catch (error) {
        log(`no credential store on this host (${String(error)}); the token for ${keyOf(ref)} goes to ${this.path}`)
        storage = 'file'
      }
      const entry: StoredEntry = { provider: ref.provider, host: ref.host.toLowerCase(), login: ref.login, storage, ...(storage === 'file' ? { token } : {}) }
      await this.write({ accounts: [...file.accounts.filter((a) => keyOf(a) !== keyOf(ref)), entry] })
      return storage
    })
  }

  remove(ref: HostingAccountRef): Promise<boolean> {
    return this.serial(async () => {
      const file = await this.read()
      const entry = file.accounts.find((a) => keyOf(a) === keyOf(ref))
      if (!entry) return false
      if (entry.storage === 'keyring') await this.keyring.delete(keyOf(ref)).catch((error: unknown) => log(`removing ${keyOf(ref)} from the credential store failed: ${String(error)}`))
      await this.write({ accounts: file.accounts.filter((a) => keyOf(a) !== keyOf(ref)) })
      return true
    })
  }
}
