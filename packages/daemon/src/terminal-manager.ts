import { existsSync } from 'node:fs'
import type { ShellOption, TerminalInfo } from '@acp-harness/protocol'
import { log } from './log.ts'

/** Enough scrollback for a reloaded window to repaint a busy screen. */
const REPLAY_LIMIT = 256 * 1024
/** Output is batched so a chatty program does not send one notification per read. */
const FLUSH_MS = 8

interface ShellSpec extends ShellOption {
  argv: string[]
}

interface LiveTerminal {
  info: TerminalInfo
  pty: Bun.Terminal
  proc: Bun.Subprocess
  replay: string
  pending: string
  flushTimer: ReturnType<typeof setTimeout> | null
}

export class TerminalManager {
  private readonly terminals = new Map<string, LiveTerminal>()
  private readonly shells = detectShells()
  private readonly changeListeners = new Set<(list: TerminalInfo[]) => void>()
  private readonly outputListeners = new Set<(terminalId: string, data: string) => void>()

  onChange(listener: (list: TerminalInfo[]) => void): void {
    this.changeListeners.add(listener)
  }

  onOutput(listener: (terminalId: string, data: string) => void): void {
    this.outputListeners.add(listener)
  }

  listShells(): ShellOption[] {
    return this.shells.map(({ id, label }) => ({ id, label }))
  }

  list(): TerminalInfo[] {
    return [...this.terminals.values()].map((t) => t.info)
  }

  create(params: { workspaceId: string; cwd: string; shellId?: string; cols: number; rows: number }): TerminalInfo {
    const shell = this.shells.find((s) => s.id === params.shellId) ?? this.shells[0]
    if (!shell) throw new Error('No shell found on this host')
    const info: TerminalInfo = {
      id: crypto.randomUUID(),
      workspaceId: params.workspaceId,
      title: shell.label,
      shell: shell.argv[0]!,
      cwd: params.cwd,
      createdAt: Date.now(),
      exitCode: null
    }
    const decoder = new TextDecoder()
    const pty = new Bun.Terminal({
      cols: Math.max(2, params.cols),
      rows: Math.max(2, params.rows),
      data: (_terminal, bytes) => this.push(info.id, decoder.decode(bytes, { stream: true }))
    })
    const proc = Bun.spawn(shell.argv, {
      cwd: params.cwd,
      terminal: pty,
      env: { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' },
      // Typed only on the non-terminal overloads; ConPTY children still need it to stay hidden.
      ...({ windowsHide: true } as object)
    })
    const live: LiveTerminal = { info, pty, proc, replay: '', pending: '', flushTimer: null }
    this.terminals.set(info.id, live)
    void proc.exited.then((code) => {
      this.flush(live)
      live.info = { ...live.info, exitCode: code ?? 0 }
      pty.close()
      this.changed()
    })
    log(`terminal ${info.id} (${shell.label}) in ${params.cwd}`)
    this.changed()
    return info
  }

  replay(terminalId: string): string {
    const live = this.require(terminalId)
    return live.replay + live.pending
  }

  write(terminalId: string, data: string): void {
    const live = this.require(terminalId)
    if (live.info.exitCode === null) live.pty.write(data)
  }

  resize(terminalId: string, cols: number, rows: number): void {
    const live = this.require(terminalId)
    if (live.info.exitCode === null) live.pty.resize(Math.max(2, cols), Math.max(2, rows))
  }

  close(terminalId: string): void {
    const live = this.terminals.get(terminalId)
    if (!live) return
    if (live.info.exitCode === null) live.proc.kill()
    live.pty.close()
    this.terminals.delete(terminalId)
    this.changed()
  }

  /** Terminals of a workspace that no longer exists. */
  closeWorkspace(workspaceId: string): void {
    for (const t of this.list()) if (t.workspaceId === workspaceId) this.close(t.id)
  }

  private push(terminalId: string, data: string): void {
    const live = this.terminals.get(terminalId)
    if (!live || !data) return
    live.pending += data
    live.flushTimer ??= setTimeout(() => this.flush(live), FLUSH_MS)
  }

  private flush(live: LiveTerminal): void {
    if (live.flushTimer) clearTimeout(live.flushTimer)
    live.flushTimer = null
    if (!live.pending) return
    const data = live.pending
    live.pending = ''
    live.replay = (live.replay + data).slice(-REPLAY_LIMIT)
    for (const listener of this.outputListeners) listener(live.info.id, data)
  }

  private require(terminalId: string): LiveTerminal {
    const live = this.terminals.get(terminalId)
    if (!live) throw new Error(`Unknown terminal ${terminalId}`)
    return live
  }

  private changed(): void {
    const list = this.list()
    for (const listener of this.changeListeners) listener(list)
  }
}

function detectShells(): ShellSpec[] {
  if (process.platform === 'win32') {
    const shells: ShellSpec[] = []
    const pwsh = Bun.which('pwsh')
    if (pwsh) shells.push({ id: 'pwsh', label: 'PowerShell 7', argv: [pwsh, '-NoLogo'] })
    shells.push({ id: 'powershell', label: 'Windows PowerShell', argv: ['powershell.exe', '-NoLogo'] })
    shells.push({ id: 'cmd', label: 'Command Prompt', argv: ['cmd.exe'] })
    const gitBash = ['C:\\Program Files\\Git\\bin\\bash.exe'].find((p) => existsSync(p))
    if (gitBash) shells.push({ id: 'git-bash', label: 'Git Bash', argv: [gitBash, '--login', '-i'] })
    return shells
  }
  const login = process.env.SHELL || '/bin/bash'
  return [{ id: 'login', label: login.split('/').at(-1) ?? 'shell', argv: [login, '-l'] }]
}
