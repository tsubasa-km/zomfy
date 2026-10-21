import { lstat, mkdir, rename, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, extname, join, parse } from 'node:path'
import { dlopen, FFIType, ptr } from 'bun:ffi'

/** Moves an entry to this host's trash; returns why not when the host has none for that path. */
export async function moveToTrash(absolute: string): Promise<true | string> {
  try {
    if (process.platform === 'win32') return recycleWindows(absolute)
    if (process.platform === 'darwin') return await trashByRename(absolute, join(homedir(), '.Trash'), null)
    return await trashFreedesktop(absolute)
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}

// ── Windows: SHFileOperationW with FOF_ALLOWUNDO, through FFI so no shell is spawned ──

const FO_DELETE = 3
const FOF_SILENT = 0x4
const FOF_NOCONFIRMATION = 0x10
const FOF_ALLOWUNDO = 0x40
const FOF_NOERRORUI = 0x400
const DRIVE_FIXED = 3

function recycleWindows(absolute: string): true | string {
  // Without a recycle bin SHFileOperation deletes for good, silently: only fixed local drives qualify.
  const root = parse(absolute).root
  if (!/^[a-z]:\\$/i.test(root)) return 'Network and WSL paths have no Recycle Bin'
  const kernel32 = dlopen('kernel32.dll', { GetDriveTypeW: { args: [FFIType.ptr], returns: FFIType.u32 } })
  const shell32 = dlopen('shell32.dll', { SHFileOperationW: { args: [FFIType.ptr], returns: FFIType.i32 } })
  try {
    const rootWide = Buffer.from(`${root}\0`, 'utf16le')
    if (kernel32.symbols.GetDriveTypeW(ptr(rootWide)) !== DRIVE_FIXED) return `${root} has no Recycle Bin`
    // pFrom is a double-NUL-terminated list.
    const from = Buffer.from(`${absolute}\0\0`, 'utf16le')
    // SHFILEOPSTRUCTW on x64: hwnd@0 wFunc@8 pFrom@16 pTo@24 fFlags@32 fAnyOperationsAborted@36 … size 56.
    const op = new ArrayBuffer(56)
    const view = new DataView(op)
    view.setUint32(8, FO_DELETE, true)
    view.setBigUint64(16, BigInt(ptr(from)), true)
    view.setUint16(32, FOF_SILENT | FOF_NOCONFIRMATION | FOF_ALLOWUNDO | FOF_NOERRORUI, true)
    const code = shell32.symbols.SHFileOperationW(ptr(new Uint8Array(op)))
    if (code !== 0) return `Recycle Bin refused the delete (code ${code})`
    if (view.getInt32(36, true) !== 0) return 'Moving to the Recycle Bin was cancelled'
    return true
  } finally {
    kernel32.close()
    shell32.close()
  }
}

// ── Linux / WSL: the freedesktop.org home trash, when the entry is on the same filesystem ──

async function trashFreedesktop(absolute: string): Promise<true | string> {
  const dataHome = process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share')
  return trashByRename(absolute, join(dataHome, 'Trash', 'files'), join(dataHome, 'Trash', 'info'))
}

async function trashByRename(absolute: string, filesDir: string, infoDir: string | null): Promise<true | string> {
  await mkdir(filesDir, { recursive: true })
  if (infoDir) await mkdir(infoDir, { recursive: true })
  // Rename only works within one filesystem; a copy across mounts would not be a trash move.
  const [entry, trash] = await Promise.all([lstat(absolute), stat(filesDir)])
  if (entry.dev !== trash.dev) return 'The trash is on a different filesystem than this workspace'
  const name = await freeName(filesDir, basename(absolute))
  if (infoDir) {
    const info = `[Trash Info]\nPath=${encodeURI(absolute)}\nDeletionDate=${localIsoSeconds(new Date())}\n`
    await writeFile(join(infoDir, `${name}.trashinfo`), info, { flag: 'wx' })
  }
  await rename(absolute, join(filesDir, name))
  return true
}

async function freeName(dir: string, name: string): Promise<string> {
  const ext = extname(name)
  const stem = name.slice(0, name.length - ext.length)
  for (let n = 1; ; n++) {
    const candidate = n === 1 ? name : `${stem}.${n}${ext}`
    const taken = await lstat(join(dir, candidate)).then(
      () => true,
      () => false
    )
    if (!taken) return candidate
  }
}

function localIsoSeconds(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}
