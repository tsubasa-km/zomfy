import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import {
  SSH_CONNECTION_TAGS,
  sshConnectionHostError,
  type SshConnection,
  type SshConnectionInput,
  type TerminalConnection
} from '@zomfy/protocol'
import { HARNESS_HOME } from './harness-home.ts'

// Saved SSH connections (protocol ssh-connections.ts), kept on the host whose ssh logs in to them.
// Nothing secret is stored: keys stay in their files and passwords are typed at ssh's prompt.

const FILE = join(HARNESS_HOME, 'ssh-connections.json')

const text = (value: unknown, max = 500): string | null => {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed.slice(0, max) : null
}

/** A connection as the person entered it, checked: ssh gets these as separate arguments, never through a shell. */
export function cleanConnection(input: SshConnectionInput): SshConnectionInput {
  const host = (input.host ?? '').trim()
  const hostError = sshConnectionHostError(host)
  if (hostError) throw new Error(hostError)
  const user = text(input.user, 200)
  if (user && (user.startsWith('-') || /[\s@"'`$;&|<>]/.test(user))) throw new Error('Not a valid user name')
  const port = input.port === null || input.port === undefined ? null : Number(input.port)
  if (port !== null && (!Number.isInteger(port) || port < 1 || port > 65535)) throw new Error('The port is a number from 1 to 65535')
  const proxyJump = text(input.proxyJump)
  if (proxyJump && (proxyJump.startsWith('-') || /[\s"'`$;&|<>]/.test(proxyJump))) throw new Error('Not a valid jump host list')
  const identityFile = text(input.identityFile, 1000)
  if (identityFile?.startsWith('-')) throw new Error('Not a valid key file')
  return {
    name: text(input.name, 200) ?? host,
    host,
    port,
    user,
    identityFile,
    proxyJump,
    group: text(input.group, 200),
    tag: input.tag && SSH_CONNECTION_TAGS.includes(input.tag) ? input.tag : null
  }
}

/** The arguments after `ssh`: options first, then the destination, so nothing in it reads as an option. */
export function sshArgs(connection: SshConnection): string[] {
  return [
    ...(connection.port ? ['-p', String(connection.port)] : []),
    ...(connection.user ? ['-l', connection.user] : []),
    ...(connection.identityFile ? ['-i', connection.identityFile] : []),
    ...(connection.proxyJump ? ['-J', connection.proxyJump] : []),
    '--',
    connection.host
  ]
}

export function terminalConnection(connection: SshConnection): TerminalConnection {
  return { id: connection.id, name: connection.name, tag: connection.tag }
}

export class SshConnectionStore {
  private connections: Promise<SshConnection[]> | null = null

  list(): Promise<SshConnection[]> {
    this.connections ??= readFile(FILE, 'utf8')
      .then((raw) => {
        const parsed: unknown = JSON.parse(raw)
        return Array.isArray(parsed) ? (parsed as SshConnection[]) : []
      })
      .catch(() => [])
    return this.connections
  }

  async get(id: string): Promise<SshConnection> {
    const found = (await this.list()).find((c) => c.id === id)
    if (!found) throw new Error('That connection no longer exists')
    return found
  }

  async save(id: string | undefined, input: SshConnectionInput): Promise<SshConnection[]> {
    const fields = cleanConnection(input)
    const list = await this.list()
    if (!id) return this.write([...list, { ...fields, id: crypto.randomUUID(), createdAt: Date.now() }])
    if (!list.some((c) => c.id === id)) throw new Error('That connection no longer exists')
    return this.write(list.map((c) => (c.id === id ? { ...c, ...fields } : c)))
  }

  async remove(id: string): Promise<SshConnection[]> {
    return this.write((await this.list()).filter((c) => c.id !== id))
  }

  private async write(list: SshConnection[]): Promise<SshConnection[]> {
    this.connections = Promise.resolve(list)
    await mkdir(dirname(FILE), { recursive: true })
    const temp = `${FILE}.tmp`
    await writeFile(temp, JSON.stringify(list, null, 2))
    await rename(temp, FILE)
    return list
  }
}
