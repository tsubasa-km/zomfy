import { useEffect, useRef, useState } from 'react'
import { MoreHorizontal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { findWorkspace } from '@/session-store'
import { t } from '@/i18n/i18n'
import './editor-panel.css'

export function absoluteEditorPath(workspaceId: string, path: string): string {
  const root = findWorkspace(workspaceId)?.path
  if (!root) return path
  const separator = root.includes('\\') ? '\\' : '/'
  return `${root.replace(/[\\/]+$/, '')}${separator}${path.split('/').join(separator)}`
}

function splitPathForDisplay(path: string): { prefix: string; fileName: string } {
  const slash = path.lastIndexOf('/')
  return slash < 0 ? { prefix: '', fileName: path } : { prefix: path.slice(0, slash + 1), fileName: path.slice(slash + 1) }
}

/** Orca's editor header: the path (click copies it), status chips, view controls and the "…" menu. */
export function EditorPanelHeader({
  workspaceId,
  path,
  status,
  controls,
  menuItems
}: {
  workspaceId: string
  path: string
  status?: React.ReactNode
  controls?: React.ReactNode
  menuItems?: React.ReactNode
}): React.JSX.Element {
  const [copied, setCopied] = useState(false)
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(timer.current), [])
  const absolute = absoluteEditorPath(workspaceId, path)
  const display = splitPathForDisplay(path)

  const copy = (text: string): void => {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => setCopied(false), 1400)
    })
  }

  return (
    <div className="editor-header">
      <div className="editor-header-text">
        <div className="editor-header-path-row">
          <button
            type="button"
            className="editor-header-path"
            title={absolute}
            data-editor-header-path
            onClick={() => copy(absolute)}
          >
            <span className="editor-header-path-prefix">{display.prefix}</span>
            <span className="editor-header-path-file">{display.fileName}</span>
          </button>
          <span className={`editor-header-copy-toast${copied ? ' is-visible' : ''}`} aria-live="polite">
            {t('File path copied')}
          </span>
          {status}
        </div>
      </div>
      {controls}
      <DropdownMenu modal={false}>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-xs" aria-label={t('File actions')} data-editor-actions-menu>
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent side="bottom" sideOffset={4}>
            {t('File actions')}
          </TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="end" sideOffset={4} className="min-w-48">
          <DropdownMenuItem onSelect={() => copy(absolute)}>{t('Copy Path')}</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => copy(path)}>{t('Copy Relative Path')}</DropdownMenuItem>
          {menuItems && <DropdownMenuSeparator />}
          {menuItems}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

/** Orca's small header icon button with a tooltip. */
export function EditorHeaderButton({
  label,
  onClick,
  disabled,
  pressed,
  children
}: {
  label: string
  onClick: () => void
  disabled?: boolean
  pressed?: boolean
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          aria-pressed={pressed}
          disabled={disabled}
          onClick={onClick}
          className="flex-shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-muted-foreground aria-pressed:bg-accent aria-pressed:text-foreground"
        >
          {children}
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom" sideOffset={4}>
        {label}
      </TooltipContent>
    </Tooltip>
  )
}
