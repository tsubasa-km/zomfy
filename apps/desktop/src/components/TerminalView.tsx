import { useEffect, useRef, useState } from 'react'
import { Ellipsis } from 'lucide-react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { isLinkModifier, openHref } from '@/lib/link-routing'
import { HARNESS_METHODS, type TerminalInfo } from '@acp-harness/protocol'
import { harnessRequest, subscribeTerminalOutput } from '@/daemon-connection'
import { closeTerminalPane, splitTerminalPane } from '@/components/terminal/terminal-pane-commands'
import { currentTerminalTheme, useTerminalTheme } from '@/lib/terminal-themes'
import { matchTerminalShortcut } from '@/lib/terminal-shortcuts'
import { registerFileLinks } from '@/lib/terminal-file-links'
import { dropPathsText, pathsFromDataTransfer, registerTerminalDropTarget } from '@/lib/terminal-file-drop'
import { filePathDrag } from '@/lib/file-path-drag'
import { commandsForProject, newQuickCommand, runQuickCommandInTerminal, useQuickCommands } from '@/lib/quick-commands'
import { LOCAL_HOST, allProjects, allWorkspaces, getState, useStore } from '@/session-store'
import { getSettings, useSetting, useSettings, type AppSettings } from '@/stores/settings-store'
import { t } from '@/i18n/i18n'
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

/** xterm options from the Appearance and Terminal settings. */
function terminalOptions(s: AppSettings) {
  return {
    fontFamily: s.terminalFontFamily.trim() || cssVar('--font-mono') || 'Cascadia Code, Consolas, monospace',
    fontSize: s.terminalFontSize,
    lineHeight: s.terminalLineHeight,
    cursorStyle: s.terminalCursorStyle,
    cursorBlink: s.terminalCursorBlink,
    scrollback: s.terminalScrollbackRows
  }
}

/** A stable key for the settings terminalOptions reads, so panes redraw only when one changes. */
function terminalOptionsKey(s: AppSettings): string {
  return JSON.stringify([s.terminalFontFamily, s.terminalFontSize, s.terminalLineHeight, s.terminalCursorStyle, s.terminalCursorBlink, s.terminalScrollbackRows])
}

/**
 * One shell from the daemon, drawn with xterm.js as Orca's terminal panes are. `embedded` is a
 * terminal under a chat code block: it neither takes focus on mount nor splits.
 */
export function TerminalView({ terminal, embedded = false }: { terminal: TerminalInfo; embedded?: boolean }) {
  const host = useRef<HTMLDivElement>(null)
  const xtermRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const theme = useTerminalTheme()
  const optionsKey = useSettings(terminalOptionsKey)
  const cwdRef = useRef(terminal.cwd)
  cwdRef.current = terminal.cwd
  const [searchAddon, setSearchAddon] = useState<SearchAddon | null>(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const [settingTitle, setSettingTitle] = useState(false)
  const rightClick = useSetting('terminalRightClick')
  // The key handler is set up once per xterm; it opens the menu through this ref.
  const openMenuAtCursorRef = useRef(() => {})

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
  // Paths dragged from the file explorer, typed as the explorer gives them (workspace-relative).
  const explorerDropRef = filePathDrag.useDropTarget({ accepts: () => true, drop: (drag) => dropRef.current(drag.paths) })

  useEffect(() => {
    const element = host.current
    if (!element) return
    const xterm = new Terminal({
      ...terminalOptions(getSettings()),
      // The search addon's match decorations use the proposed decoration API.
      allowProposedApi: true,
      theme: currentTerminalTheme()
    })
    xtermRef.current = xterm
    const fit = new FitAddon()
    fitRef.current = fit
    const search = new SearchAddon()
    xterm.loadAddon(fit)
    xterm.loadAddon(search)
    // Same route as every other link: system browser, Mod+click to an in-app tab.
    xterm.loadAddon(new WebLinksAddon((event, uri) => openHref(uri, { inApp: isLinkModifier(event), workspaceId: terminal.workspaceId })))
    xterm.open(element)
    // xterm 6 draws no cursor until its first focus; an alternate-screen round trip starts it, so a
    // terminal nobody has clicked yet (a drawer's, a background split pane's) still shows one.
    xterm.write('[?1047h[?1047l')
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
      // The keyboard's way to the menu, which copy/paste right-clicks leave without a click.
      if (e.type === 'keydown' && (e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey && !e.ctrlKey && !e.altKey))) {
        e.preventDefault()
        openMenuAtCursorRef.current()
        return false
      }
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
    if (!embedded) xterm.focus()

    const unregisterDrop = registerTerminalDropTarget(terminal.id, (paths) => dropRef.current(paths))

    return () => {
      clearTimeout(resizeTimer)
      observer.disconnect()
      unregisterDrop()
      fileLinks.dispose()
      input.dispose()
      unsubscribe()
      setSearchAddon(null)
      xtermRef.current = null
      fitRef.current = null
      xterm.dispose()
    }
    // A restart bumps startedAt: the old screen goes and the new shell's output replays.
  }, [terminal.id, terminal.workspaceId, terminal.startedAt])

  // The terminal theme follows the app's light/dark mode and the theme picked for each.
  useEffect(() => {
    if (xtermRef.current) xtermRef.current.options.theme = theme
  }, [theme])

  // Font, cursor and scrollback settings apply to open terminals; a new font size or line
  // height changes how many rows and columns fit, so the pane refits.
  useEffect(() => {
    const xterm = xtermRef.current
    if (!xterm) return
    Object.assign(xterm.options, terminalOptions(getSettings()))
    const element = host.current
    if (!element || element.clientWidth === 0 || element.clientHeight === 0) return
    fitRef.current?.fit()
    if (!isRunning(terminal.id)) return
    void harnessRequest(HARNESS_METHODS.terminalResize, { terminalId: terminal.id, cols: xterm.cols, rows: xterm.rows }).catch(
      () => undefined
    )
  }, [optionsKey, terminal.id])

  const focus = () => xtermRef.current?.focus()
  const paste = () =>
    void navigator.clipboard
      .readText()
      .then((text) => {
        if (text) xtermRef.current?.paste(text)
      })
      .catch(() => undefined)
      .finally(focus)
  /** Windows Terminal's right-click: copy the selection and clear it, or paste when nothing is selected. */
  const copyOrPaste = () => {
    const xterm = xtermRef.current
    if (!xterm) return
    if (xterm.hasSelection()) {
      void navigator.clipboard.writeText(xterm.getSelection())
      xterm.clearSelection()
      focus()
    } else paste()
  }
  /** The menu by the text cursor, for Shift+F10 and the menu key. */
  openMenuAtCursorRef.current = () => {
    const xterm = xtermRef.current
    const screen = xterm?.element?.querySelector('.xterm-screen')
    const outer = host.current?.parentElement
    if (!xterm || !screen || !outer) return
    const box = screen.getBoundingClientRect()
    const origin = outer.getBoundingClientRect()
    const buffer = xterm.buffer.active
    setMenu({
      x: box.left - origin.left + ((buffer.cursorX + 1) * box.width) / xterm.cols,
      y: box.top - origin.top + ((buffer.cursorY + 1) * box.height) / xterm.rows
    })
  }
  const restart = () => void harnessRequest(HARNESS_METHODS.terminalRestart, { terminalId: terminal.id })
  const rename = (title: string | null) =>
    void harnessRequest(HARNESS_METHODS.terminalRename, { terminalId: terminal.id, title })

  return (
    <div
      ref={explorerDropRef}
      className="group/terminal relative flex min-h-0 min-w-0 flex-1 flex-col"
      style={{ background: theme.background }}
      onContextMenu={(e) => {
        if (!(e.target instanceof Node) || !host.current?.contains(e.target)) return
        e.preventDefault()
        // Shift swaps the two right-click behaviours, so either mode reaches the other one.
        if ((rightClick === 'copy-paste') !== e.shiftKey) {
          copyOrPaste()
          return
        }
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
      {/* With copy/paste right-clicks the menu has no click of its own; this shows on hover. */}
      {rightClick === 'copy-paste' && !searchOpen && (
        <button
          type="button"
          data-terminal-menu-button
          aria-label={t('Terminal menu')}
          title={t('Terminal menu (Shift+right-click)')}
          className="absolute top-2 right-2 z-10 flex size-6 items-center justify-center rounded-md border border-border/60 bg-popover/90 text-muted-foreground opacity-0 shadow-sm transition-opacity group-hover/terminal:opacity-100 hover:text-foreground focus-visible:opacity-100"
          onClick={(e) => {
            const box = e.currentTarget.parentElement!.getBoundingClientRect()
            const button = e.currentTarget.getBoundingClientRect()
            setMenu({ x: button.right - box.left - 240, y: button.bottom - box.top + 4 })
          }}
        >
          <Ellipsis className="size-3.5" />
        </button>
      )}
      {searchOpen && searchAddon && (
        <TerminalSearch
          searchAddon={searchAddon}
          onClose={() => {
            setSearchOpen(false)
            focus()
          }}
        />
      )}
      {/* Under a code block the header says how it ended; the output stays uncovered. */}
      {!embedded && terminal.exitCode !== null && (
        <TerminalProcessExitOverlay
          exitCode={terminal.exitCode}
          onRestart={restart}
          onClose={() => closeTerminalPane(terminal.workspaceId, terminal.id)}
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
        onSplit={embedded ? undefined : (direction) => void splitTerminalPane(terminal.workspaceId, terminal.id, direction)}
        onSetTitle={() => setSettingTitle(true)}
        onClearTitle={terminal.customTitle ? () => rename(null) : null}
        onCopyTerminalId={() => void navigator.clipboard.writeText(terminal.id)}
        onClose={() => closeTerminalPane(terminal.workspaceId, terminal.id)}
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
