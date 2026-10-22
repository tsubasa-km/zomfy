import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { isLinkModifier, openHref } from '@/lib/link-routing'
import { HARNESS_METHODS, type TerminalInfo } from '@acp-harness/protocol'
import { closeTerminal, harnessRequest, subscribeTerminalOutput } from '@/daemon-connection'
import { splitTerminal } from '@/components/terminal/terminal-split'
import { currentTerminalTheme } from '@/lib/terminal-themes'
import { matchTerminalShortcut } from '@/lib/terminal-shortcuts'
import { registerFileLinks } from '@/lib/terminal-file-links'
import { dropPathsText, pathsFromDataTransfer, registerTerminalDropTarget } from '@/lib/terminal-file-drop'
import { commandsForProject, newQuickCommand, runQuickCommandInTerminal, useQuickCommands } from '@/lib/quick-commands'
import { LOCAL_HOST, allProjects, allWorkspaces, getState, useStore } from '@/session-store'
import { TerminalContextMenu } from '@/components/terminal/TerminalContextMenu'
import { TerminalSearch } from '@/components/terminal/TerminalSearch'
import { TerminalProcessExitOverlay } from '@/components/terminal/TerminalProcessExitOverlay'
import { SetTerminalTitleDialog } from '@/components/terminal/SetTerminalTitleDialog'
import { requestQuickCommandEditor } from '@/components/terminal/QuickCommandDialog'
import '@xterm/xterm/css/xterm.css'

/** Input and resizes stop once a terminal is closed or its shell exited; the daemon would refuse them. */
function isRunning(terminalId: string): boolean {
  return getState().terminals.some((t) => t.id === terminalId && t.exitCode === null)
}

function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim()
}

/** One shell from the daemon, drawn with xterm.js as Orca's terminal panes are. */
export function TerminalView({ terminal }: { terminal: TerminalInfo }) {
  const host = useRef<HTMLDivElement>(null)
  const xtermRef = useRef<Terminal | null>(null)
  const cwdRef = useRef(terminal.cwd)
  cwdRef.current = terminal.cwd
  const [searchAddon, setSearchAddon] = useState<SearchAddon | null>(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const [settingTitle, setSettingTitle] = useState(false)

  const hostId = useStore((s) => s.terminals.find((t) => t.id === terminal.id)?.hostId ?? LOCAL_HOST)
  const projectId = useStore((s) => allWorkspaces(s).find((w) => w.id === terminal.workspaceId)?.projectId ?? null)
  const projectLabel = useStore((s) => allProjects(s.hosts).find((p) => p.id === projectId)?.name ?? null)
  const quickCommands = commandsForProject(useQuickCommands(hostId), projectId)
  const shellKind = terminal.shellKind ?? 'posix'

  const send = (data: string) => {
    if (!isRunning(terminal.id)) return
    void harnessRequest(HARNESS_METHODS.terminalInput, { terminalId: terminal.id, data }).catch(() => undefined)
  }
  const sendRef = useRef(send)
  sendRef.current = send
  const dropRef = useRef((_paths: string[]) => {})
  dropRef.current = (paths) => {
    if (paths.length === 0) return
    send(dropPathsText(paths, shellKind, hostId))
    xtermRef.current?.focus()
  }

  useEffect(() => {
    const element = host.current
    if (!element) return
    const xterm = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: cssVar('--font-mono') || 'Cascadia Code, Consolas, monospace',
      scrollback: 10_000,
      // The search addon's match decorations use the proposed decoration API.
      allowProposedApi: true,
      theme: currentTerminalTheme()
    })
    xtermRef.current = xterm
    const fit = new FitAddon()
    const search = new SearchAddon()
    xterm.loadAddon(fit)
    xterm.loadAddon(search)
    // Same route as every other link: system browser, Mod+click to an in-app tab.
    xterm.loadAddon(new WebLinksAddon((event, uri) => openHref(uri, { inApp: isLinkModifier(event), workspaceId: terminal.workspaceId })))
    xterm.open(element)
    setSearchAddon(search)
    const fileLinks = registerFileLinks(xterm, terminal.id, terminal.workspaceId, () => cwdRef.current)

    // Live output that arrives before the replay is written waits, so the screen stays in order.
    let replayed = false
    const queued: string[] = []
    const unsubscribe = subscribeTerminalOutput(terminal.id, (data) => {
      if (replayed) xterm.write(data)
      else queued.push(data)
    })
    void harnessRequest(HARNESS_METHODS.terminalAttach, { terminalId: terminal.id })
      .then(({ buffer }) => {
        xterm.write(buffer)
        for (const data of queued) xterm.write(data)
        queued.length = 0
        replayed = true
      })
      .catch(() => undefined)

    const input = xterm.onData((data) => sendRef.current(data))

    xterm.attachCustomKeyEventHandler((e) => {
      const action = matchTerminalShortcut(e, xterm.hasSelection())
      if (!action) return true
      // Paste is left to the browser's paste event, which xterm turns into a (bracketed) paste.
      if (action === 'paste') return false
      e.preventDefault()
      if (action === 'copy') {
        void navigator.clipboard.writeText(xterm.getSelection())
        xterm.clearSelection()
      } else if (action === 'selectAll') xterm.selectAll()
      else if (action === 'clear') xterm.clear()
      else setSearchOpen(true)
      return false
    })

    let resizeTimer: ReturnType<typeof setTimeout> | undefined
    const observer = new ResizeObserver(() => {
      if (element.clientWidth === 0 || element.clientHeight === 0) return
      fit.fit()
      clearTimeout(resizeTimer)
      // The PTY resize is debounced; xterm itself reflows on every frame.
      resizeTimer = setTimeout(() => {
        if (!isRunning(terminal.id)) return
        void harnessRequest(HARNESS_METHODS.terminalResize, {
          terminalId: terminal.id,
          cols: xterm.cols,
          rows: xterm.rows
        }).catch(() => undefined)
      }, 80)
    })
    observer.observe(element)
    xterm.focus()

    // Follow the OS light/dark switch the app theme already tracks.
    const themeObserver = new MutationObserver(() => (xterm.options.theme = currentTerminalTheme()))
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })

    const unregisterDrop = registerTerminalDropTarget(terminal.id, (paths) => dropRef.current(paths))

    return () => {
      clearTimeout(resizeTimer)
      observer.disconnect()
      themeObserver.disconnect()
      unregisterDrop()
      fileLinks.dispose()
      input.dispose()
      unsubscribe()
      setSearchAddon(null)
      xtermRef.current = null
      xterm.dispose()
    }
    // A restart bumps startedAt: the old screen goes and the new shell's output replays.
  }, [terminal.id, terminal.workspaceId, terminal.startedAt])

  const focus = () => xtermRef.current?.focus()
  const paste = () =>
    void navigator.clipboard
      .readText()
      .then((text) => {
        if (text) xtermRef.current?.paste(text)
      })
      .catch(() => undefined)
      .finally(focus)
  const restart = () => void harnessRequest(HARNESS_METHODS.terminalRestart, { terminalId: terminal.id })
  const rename = (title: string | null) =>
    void harnessRequest(HARNESS_METHODS.terminalRename, { terminalId: terminal.id, title })

  return (
    <div
      className="relative flex min-h-0 min-w-0 flex-1 flex-col"
      style={{ background: currentTerminalTheme().background }}
      onContextMenu={(e) => {
        if (!(e.target instanceof Node) || !host.current?.contains(e.target)) return
        e.preventDefault()
        const box = e.currentTarget.getBoundingClientRect()
        setMenu({ x: e.clientX - box.left, y: e.clientY - box.top })
      }}
      onDragOver={(e) => {
        if (e.dataTransfer.types.some((t) => t === 'text/uri-list' || t === 'text/plain')) {
          e.preventDefault()
          e.dataTransfer.dropEffect = 'copy'
        }
      }}
      onDrop={(e) => {
        const paths = pathsFromDataTransfer(e.dataTransfer)
        if (paths.length === 0) return
        e.preventDefault()
        dropRef.current(paths)
      }}
    >
      <div ref={host} data-terminal-id={terminal.id} className="min-h-0 flex-1 px-3 pt-2" />
      {searchOpen && searchAddon && (
        <TerminalSearch
          searchAddon={searchAddon}
          onClose={() => {
            setSearchOpen(false)
            focus()
          }}
        />
      )}
      {terminal.exitCode !== null && (
        <TerminalProcessExitOverlay
          exitCode={terminal.exitCode}
          onRestart={restart}
          onClose={() => closeTerminal(terminal.id)}
        />
      )}
      <TerminalContextMenu
        open={menu !== null}
        point={menu ?? { x: 0, y: 0 }}
        onOpenChange={(open) => {
          if (!open) setMenu(null)
        }}
        onCopy={() => {
          const xterm = xtermRef.current
          if (xterm?.hasSelection()) void navigator.clipboard.writeText(xterm.getSelection())
          focus()
        }}
        onPaste={paste}
        onSelectAll={() => xtermRef.current?.selectAll()}
        onFind={() => setSearchOpen(true)}
        onSplit={(direction) => void splitTerminal(terminal.workspaceId, terminal.id, terminal.shellId, direction)}
        onSetTitle={() => setSettingTitle(true)}
        onClearTitle={terminal.customTitle ? () => rename(null) : null}
        onCopyTerminalId={() => void navigator.clipboard.writeText(terminal.id)}
        onClose={() => closeTerminal(terminal.id)}
        onClearScreen={() => {
          xtermRef.current?.clear()
          focus()
        }}
        onResetTerminal={() => {
          xtermRef.current?.reset()
          focus()
        }}
        onRestart={restart}
        quickCommands={{ ...quickCommands, projectLabel }}
        onQuickCommand={(command) => {
          runQuickCommandInTerminal(terminal.id, terminal.workspaceId, command)
          focus()
        }}
        onAddQuickCommand={() =>
          requestQuickCommandEditor({
            workspaceId: terminal.workspaceId,
            hostId,
            mode: 'add',
            command: newQuickCommand(projectId ? { type: 'project', projectId } : { type: 'global' })
          })
        }
      />
      {settingTitle && (
        <SetTerminalTitleDialog
          initial={terminal.customTitle ?? terminal.title}
          onCancel={() => {
            setSettingTitle(false)
            focus()
          }}
          onSave={(title) => {
            setSettingTitle(false)
            rename(title)
            focus()
          }}
        />
      )}
    </div>
  )
}
