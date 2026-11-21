import { Component, useState, type ErrorInfo, type ReactNode } from 'react'
import { ClipboardCopy, RotateCcw, TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { t } from '@/i18n/i18n'

// A view that throws while rendering takes down only itself: without a boundary React unmounts
// the whole window and leaves it blank. The fallback says what broke, so it can be reported.

interface Props {
  children: ReactNode
  fallback: (error: Error, reset: () => void) => ReactNode
}

export class ErrorBoundary extends Component<Props, { error: Error | null }> {
  state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: unknown): { error: Error } {
    return { error: error instanceof Error ? error : new Error(String(error)) }
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error('A view failed to render', error, info.componentStack)
    if (error instanceof Error && info.componentStack) (error as Error & { componentStack?: string }).componentStack = info.componentStack
  }

  render(): ReactNode {
    return this.state.error ? this.props.fallback(this.state.error, () => this.setState({ error: null })) : this.props.children
  }
}

/**
 * What the window restores its tabs from. A tab saved in a state that fails to render would fail
 * again on every reload; reopening without them keeps every chat and project (those live on hosts).
 */
const TAB_STORAGE_KEYS = ['zomfy.layout.v1', 'zomfy.tab-layout.v1', 'zomfy.browser-tabs.v1', 'zomfy.panel-tabs.v1']

function reopenWithoutTabs(): void {
  for (const key of TAB_STORAGE_KEYS) {
    try {
      localStorage.removeItem(key)
    } catch {
      // Storage unavailable: the reload below still runs.
    }
  }
  window.location.reload()
}

function details(error: Error): string {
  const stack = (error as Error & { componentStack?: string }).componentStack
  return [`${error.name}: ${error.message}`, error.stack ?? '', stack ? `Component stack:${stack}` : ''].filter(Boolean).join('\n\n')
}

/** What a failed view shows: the error, a way to copy it for a report, and a way out. */
export function ViewError({ error, onRetry, whole = false }: { error: Error; onRetry: () => void; whole?: boolean }) {
  const [copied, setCopied] = useState(false)
  return (
    <div role="alert" className="m-auto flex w-full max-w-lg flex-col gap-3 p-6 text-sm" data-view-error={whole ? 'window' : 'view'}>
      <p className="flex items-center gap-2 font-medium">
        <TriangleAlert className="size-4 shrink-0 text-destructive" />
        {whole ? t('Zomfy hit an error and could not show this window.') : t('This view hit an error.')}
      </p>
      <pre className="scrollbar-sleek max-h-40 overflow-auto rounded-md border border-border bg-muted/40 p-2 font-mono text-xs break-all whitespace-pre-wrap">
        {error.message || error.name}
      </pre>
      <p className="text-xs text-muted-foreground">
        {whole
          ? t('Copy the details to report it, then reload. If it happens again, reopen without tabs: chats and projects stay.')
          : t('Copy the details to report it. The rest of the app keeps working.')}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" onClick={whole ? () => window.location.reload() : onRetry}>
          <RotateCcw className="size-3.5" />
          {whole ? t('Reload') : t('Try again')}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => void navigator.clipboard.writeText(details(error)).then(() => setCopied(true))}
        >
          <ClipboardCopy className="size-3.5" />
          {copied ? t('Copied') : t('Copy details')}
        </Button>
        {whole ? (
          <Button type="button" size="sm" variant="ghost" onClick={reopenWithoutTabs} data-view-error-reset-tabs>
            {t('Reopen without tabs')}
          </Button>
        ) : null}
      </div>
    </div>
  )
}
