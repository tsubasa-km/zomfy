import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, ExternalLink, Globe, Loader2, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { isImeOwnedKeyboardEvent } from '@/lib/ime-composition-keyboard-event'
import {
  BLANK_URL,
  currentUrl,
  navigateBrowserTab,
  normalizeAddress,
  reloadBrowserTab,
  stepBrowserHistory,
  type BrowserTab
} from '@/stores/browser-tab-store'

// Orca's browser chrome (browser-navigation-control-row.tsx): back, forward, reload, address bar.
// The page is an iframe, so history covers addresses typed here, not links clicked inside a
// cross-origin page, and sites that refuse framing stay blank.

export function BrowserTabView({ tab }: { tab: BrowserTab }) {
  const url = currentUrl(tab)
  const [address, setAddress] = useState(url === BLANK_URL ? '' : url)
  const [loading, setLoading] = useState(url !== BLANK_URL)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setAddress(url === BLANK_URL ? '' : url)
    setLoading(url !== BLANK_URL)
  }, [url, tab.reloadKey])

  useEffect(() => {
    if (url === BLANK_URL) input.current?.focus()
  }, [url])

  const submit = () => {
    const next = normalizeAddress(address)
    if (next === url) reloadBrowserTab(tab.id)
    else navigateBrowserTab(tab.id, next)
    input.current?.blur()
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col" data-browser-tab={tab.id}>
      <div className="relative z-10 flex shrink-0 items-center gap-2 border-b border-border/70 bg-background/95 px-3 py-1.5">
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7"
          aria-label="Back"
          disabled={tab.historyIndex === 0}
          onClick={() => stepBrowserHistory(tab.id, -1)}
        >
          <ArrowLeft className="size-4" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7"
          aria-label="Forward"
          disabled={tab.historyIndex >= tab.history.length - 1}
          onClick={() => stepBrowserHistory(tab.id, 1)}
        >
          <ArrowRight className="size-4" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7"
          aria-label="Reload"
          disabled={url === BLANK_URL}
          onClick={() => reloadBrowserTab(tab.id)}
        >
          {loading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
        </Button>
        <div className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md border border-input bg-transparent px-2.5 focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50">
          <Globe className="size-4 shrink-0 text-muted-foreground" />
          <input
            ref={input}
            data-browser-address
            aria-label="Address"
            value={address}
            placeholder="Search or enter URL"
            spellCheck={false}
            className="h-full min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/60"
            onChange={(e) => setAddress(e.target.value)}
            onFocus={(e) => e.currentTarget.select()}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !isImeOwnedKeyboardEvent(e)) {
                e.preventDefault()
                submit()
              } else if (e.key === 'Escape') {
                setAddress(url === BLANK_URL ? '' : url)
                e.currentTarget.blur()
              }
            }}
          />
        </div>
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7"
          aria-label="Open In Browser"
          title="Open In Browser"
          disabled={!/^https?:/.test(url)}
          onClick={() => window.open(url, '_blank', 'noopener')}
        >
          <ExternalLink className="size-4" />
        </Button>
      </div>
      {url === BLANK_URL ? (
        <div className="m-auto max-w-sm text-center text-sm text-muted-foreground">
          Type an address or a search above. Sites that refuse to be embedded stay blank here; open
          them in your browser instead.
        </div>
      ) : (
        <iframe
          key={`${tab.historyIndex}:${tab.reloadKey}`}
          title={url}
          src={url}
          className="min-h-0 w-full flex-1 border-0 bg-white"
          // A page must not reach the app; scripts, forms and popups still work inside it.
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads"
          referrerPolicy="no-referrer"
          onLoad={() => setLoading(false)}
        />
      )}
    </div>
  )
}
