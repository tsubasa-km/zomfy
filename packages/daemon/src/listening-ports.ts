import { readdir, readFile, readlink } from 'node:fs/promises'
import { dlopen, FFIType, ptr } from 'bun:ffi'

// Listening TCP sockets and the process table on the daemon's host, after Orca's
// local-workspace-platform-port-scanner: netstat on Windows, /proc on Linux (and WSL), lsof on macOS.

export interface RawListener {
  host: string
  port: number
  pid: number | null
}

export interface ProcessEntry {
  ppid: number | null
  name: string | null
  /** Working directory where the platform exposes it (Linux, macOS). */
  cwd?: string
}

export async function scanListeners(): Promise<RawListener[]> {
  if (process.platform === 'win32') return parseNetstat(await capture(['netstat', '-ano']))
  if (process.platform === 'linux') return scanProcNet()
  if (process.platform === 'darwin') {
    return parseLsof(await capture(['lsof', '-nP', '-iTCP', '-sTCP:LISTEN', '-F', 'pn']))
  }
  throw new Error(`Port scanning is not supported on ${process.platform}`)
}

/** Name, parent and (where available) cwd of each pid, plus their ancestors. */
export async function readProcesses(pids: Set<number>): Promise<Map<number, ProcessEntry>> {
  if (process.platform === 'win32') return windowsProcessTable()
  if (process.platform === 'linux') return linuxProcesses(pids)
  if (process.platform === 'darwin') return darwinProcesses(pids)
  return new Map()
}

async function capture(argv: string[]): Promise<string> {
  const proc = Bun.spawn(argv, { stdout: 'pipe', stderr: 'ignore', stdin: 'ignore', windowsHide: true })
  const text = await new Response(proc.stdout).text()
  await proc.exited
  return text
}

/** "127.0.0.1:80", "[::]:80", "*:80", "*.80" (lsof uses ':', netstat on BSD '.'). */
function splitAddress(value: string): { host: string; port: number } | null {
  const match = /^\[?(.*?)\]?[:.](\d+)$/.exec(value.trim())
  if (!match) return null
  const port = Number(match[2])
  return Number.isInteger(port) && port > 0 ? { host: match[1] || '*', port } : null
}

export function parseNetstat(output: string): RawListener[] {
  const listeners: RawListener[] = []
  for (const line of output.split(/\r?\n/)) {
    const fields = line.trim().split(/\s+/)
    if (fields[0]?.toUpperCase() !== 'TCP' || fields.length < 5) continue
    // The state column is localized on some Windows builds; a listener's remote side is always port 0.
    const remote = fields[2] ?? ''
    if (!/[:.]0$/.test(remote) && fields[3]?.toUpperCase() !== 'LISTENING') continue
    const local = splitAddress(fields[1] ?? '')
    const pid = Number(fields[fields.length - 1])
    if (local) listeners.push({ ...local, pid: Number.isInteger(pid) && pid > 0 ? pid : null })
  }
  return listeners
}

function parseLsof(output: string): RawListener[] {
  const listeners: RawListener[] = []
  let pid: number | null = null
  for (const line of output.split('\n')) {
    if (line[0] === 'p') pid = Number(line.slice(1)) || null
    else if (line[0] === 'n') {
      const local = splitAddress(line.slice(1))
      if (local) listeners.push({ ...local, pid })
    }
  }
  return listeners
}

// ── Linux ──

async function scanProcNet(): Promise<RawListener[]> {
  const sockets = [
    ...parseProcNetTcp(await readFile('/proc/net/tcp', 'utf8').catch(() => ''), false),
    ...parseProcNetTcp(await readFile('/proc/net/tcp6', 'utf8').catch(() => ''), true)
  ]
  const owners = await inodeOwners(new Set(sockets.map((s) => s.inode)))
  return sockets.map(({ host, port, inode }) => ({ host, port, pid: owners.get(inode) ?? null }))
}

export function parseProcNetTcp(content: string, v6: boolean): { host: string; port: number; inode: number }[] {
  const rows: { host: string; port: number; inode: number }[] = []
  for (const line of content.split('\n').slice(1)) {
    const fields = line.trim().split(/\s+/)
    // st 0A is TCP_LISTEN.
    if (fields.length < 10 || fields[3] !== '0A') continue
    const [hexHost = '', hexPort = ''] = (fields[1] ?? '').split(':')
    const inode = Number(fields[9])
    if (!inode) continue
    rows.push({ host: v6 ? decodeV6(hexHost) : decodeV4(hexHost), port: parseInt(hexPort, 16), inode })
  }
  return rows
}

/** The kernel prints each 32-bit word in host (little-endian) order. */
function decodeV4(hex: string): string {
  const bytes = hex.match(/../g)?.map((b) => parseInt(b, 16)) ?? []
  return bytes.reverse().join('.')
}

function decodeV6(hex: string): string {
  const words = hex.match(/.{8}/g) ?? []
  const bytes = words.flatMap((w) => (w.match(/../g) ?? []).reverse())
  const groups: string[] = []
  for (let i = 0; i < bytes.length; i += 2) groups.push(String(parseInt(`${bytes[i]}${bytes[i + 1]}`, 16).toString(16)))
  const address = groups.join(':')
  if (address === '0:0:0:0:0:0:0:0') return '::'
  if (address === '0:0:0:0:0:0:0:1') return '::1'
  // IPv4-mapped (::ffff:a.b.c.d).
  if (address.startsWith('0:0:0:0:0:ffff:')) return bytes.slice(12).map((b) => parseInt(b, 16)).join('.')
  return address
}

async function inodeOwners(inodes: Set<number>): Promise<Map<number, number>> {
  const owners = new Map<number, number>()
  if (inodes.size === 0) return owners
  const pids = (await readdir('/proc').catch(() => [] as string[])).filter((e) => /^\d+$/.test(e))
  await Promise.all(
    pids.map(async (pid) => {
      const fds = await readdir(`/proc/${pid}/fd`).catch(() => [] as string[])
      for (const fd of fds) {
        const link = await readlink(`/proc/${pid}/fd/${fd}`).catch(() => '')
        const inode = Number(/^socket:\[(\d+)\]$/.exec(link)?.[1])
        if (inodes.has(inode)) owners.set(inode, Number(pid))
      }
    })
  )
  return owners
}

async function linuxProcesses(pids: Set<number>): Promise<Map<number, ProcessEntry>> {
  const table = new Map<number, ProcessEntry>()
  const queue = [...pids]
  while (queue.length > 0) {
    const pid = queue.pop()!
    if (table.has(pid) || pid <= 1) continue
    const stat = await readFile(`/proc/${pid}/stat`, 'utf8').catch(() => null)
    if (!stat) continue
    // "pid (comm) state ppid …": comm may hold spaces or parens, so split at the last ')'.
    const close = stat.lastIndexOf(')')
    const name = stat.slice(stat.indexOf('(') + 1, close)
    const ppid = Number(stat.slice(close + 2).split(' ')[1]) || null
    const cwd = await readlink(`/proc/${pid}/cwd`).catch(() => undefined)
    table.set(pid, { ppid, name, ...(cwd ? { cwd } : {}) })
    if (ppid) queue.push(ppid)
  }
  return table
}

// ── macOS ──

async function darwinProcesses(pids: Set<number>): Promise<Map<number, ProcessEntry>> {
  const table = new Map<number, ProcessEntry>()
  for (const line of (await capture(['ps', '-axo', 'pid=,ppid=,comm='])).split('\n')) {
    const match = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line)
    if (match) table.set(Number(match[1]), { ppid: Number(match[2]) || null, name: match[3]!.split('/').pop() ?? null })
  }
  if (pids.size > 0) {
    let pid = 0
    const out = await capture(['lsof', '-a', '-d', 'cwd', '-p', [...pids].join(','), '-Fn'])
    for (const line of out.split('\n')) {
      if (line[0] === 'p') pid = Number(line.slice(1))
      else if (line[0] === 'n' && table.has(pid)) table.get(pid)!.cwd = line.slice(1)
    }
  }
  return table
}

// ── Windows: a Toolhelp snapshot through FFI, so a poll spawns nothing but netstat ──

const TH32CS_SNAPPROCESS = 0x2
/** sizeof(PROCESSENTRY32W) on x64. */
const ENTRY_SIZE = 568

let toolhelp: ReturnType<typeof openToolhelp> | null = null

function openToolhelp() {
  return dlopen('kernel32.dll', {
    CreateToolhelp32Snapshot: { args: [FFIType.u32, FFIType.u32], returns: FFIType.i64 },
    Process32FirstW: { args: [FFIType.i64, FFIType.ptr], returns: FFIType.i32 },
    Process32NextW: { args: [FFIType.i64, FFIType.ptr], returns: FFIType.i32 },
    CloseHandle: { args: [FFIType.i64], returns: FFIType.i32 }
  })
}

function windowsProcessTable(): Map<number, ProcessEntry> {
  toolhelp ??= openToolhelp()
  const k = toolhelp.symbols
  const table = new Map<number, ProcessEntry>()
  const snapshot = k.CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0)
  if (Number(snapshot) === -1 || Number(snapshot) === 0) return table
  try {
    const entry = new Uint8Array(ENTRY_SIZE)
    const view = new DataView(entry.buffer)
    view.setUint32(0, ENTRY_SIZE, true)
    for (let ok = k.Process32FirstW(snapshot, ptr(entry)); ok; ok = k.Process32NextW(snapshot, ptr(entry))) {
      // th32ProcessID@8, th32ParentProcessID@32, szExeFile@44 (WCHAR[260]).
      const pid = view.getUint32(8, true)
      const ppid = view.getUint32(32, true)
      const nameBytes = entry.subarray(44, 44 + 520)
      let end = 0
      while (end < nameBytes.length && (nameBytes[end] !== 0 || nameBytes[end + 1] !== 0)) end += 2
      const name = Buffer.from(nameBytes.subarray(0, end)).toString('utf16le')
      table.set(pid, { ppid: ppid || null, name: name || null })
      view.setUint32(0, ENTRY_SIZE, true)
    }
  } finally {
    k.CloseHandle(snapshot)
  }
  return table
}
