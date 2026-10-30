import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronUp, Image as ImageIcon, RotateCcw, Search, X, ZoomIn, ZoomOut } from 'lucide-react'
import * as pdfjsLib from 'pdfjs-dist'
import { EventBus, PDFFindController, PDFLinkService, PDFViewer as PdfJsViewer } from 'pdfjs-dist/web/pdf_viewer.mjs'
import 'pdfjs-dist/web/pdf_viewer.css'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { getPinchZoomFactor, shouldHandleImageZoomWheel } from './image-viewer-zoom'
import { t } from '@/i18n/i18n'

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl

const MIN_SCALE = 0.25
const MAX_SCALE = 5
const SCALE_STEP = 1.25

const clampScale = (scale: number): number => Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale))

function decodeBase64(base64: string): Uint8Array {
  const binary = window.atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
  return bytes
}

/** Orca's PdfViewer: pdf.js's own viewer with a text layer, fit-to-width, zoom and find. */
export function PdfViewer({ base64, filePath }: { base64: string; filePath: string }): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewerDivRef = useRef<HTMLDivElement>(null)
  const viewerRef = useRef<PdfJsViewer | null>(null)
  const eventBusRef = useRef<EventBus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [scale, setScale] = useState(1)
  const [pages, setPages] = useState(0)
  const [findOpen, setFindOpen] = useState(false)
  const filename = filePath.split('/').pop() || filePath

  useEffect(() => {
    const container = containerRef.current
    const viewerDiv = viewerDivRef.current
    if (!container || !viewerDiv) return
    setError(null)
    let disposed = false
    const abort = new AbortController()
    const eventBus = new EventBus()
    const linkService = new PDFLinkService({ eventBus })
    const findController = new PDFFindController({ linkService, eventBus })
    // pdf.js honours abortSignal (it releases its scroll listener) but its typings omit it.
    const viewerOptions = {
      container,
      viewer: viewerDiv,
      eventBus,
      linkService,
      findController,
      textLayerMode: 1,
      removePageBorders: true,
      abortSignal: abort.signal
    }
    const viewer = new PdfJsViewer(viewerOptions)
    linkService.setViewer(viewer)
    viewerRef.current = viewer
    eventBusRef.current = eventBus
    eventBus.on('scalechanging', (evt: { scale: number }) => setScale(evt.scale))
    eventBus.on('pagesinit', () => {
      viewer.currentScaleValue = 'page-width'
    })
    container.addEventListener(
      'wheel',
      (event) => {
        if (!shouldHandleImageZoomWheel(event)) return
        event.preventDefault()
        viewer.currentScale = clampScale(viewer.currentScale * getPinchZoomFactor(event.deltaY, event.deltaMode))
      },
      { passive: false, signal: abort.signal }
    )

    let bytes: Uint8Array
    try {
      bytes = decodeBase64(base64)
    } catch {
      setError(t('Failed to decode PDF content'))
      return () => abort.abort()
    }
    const task = pdfjsLib.getDocument({ data: bytes })
    task.promise.then(
      (doc) => {
        if (disposed) return
        viewer.setDocument(doc)
        linkService.setDocument(doc)
        findController.setDocument(doc)
        setPages(doc.numPages)
      },
      (e: unknown) => {
        if (!disposed) {
          setError(e instanceof Error && e.name === 'PasswordException' ? t('This PDF is password-protected') : t('Failed to load PDF preview'))
        }
      }
    )
    return () => {
      disposed = true
      viewerRef.current = null
      eventBusRef.current = null
      abort.abort()
      void task.destroy().catch(() => undefined)
    }
  }, [base64])

  const stepZoom = useCallback((direction: 'in' | 'out') => {
    const viewer = viewerRef.current
    if (viewer) viewer.currentScale = clampScale(direction === 'in' ? viewer.currentScale * SCALE_STEP : viewer.currentScale / SCALE_STEP)
  }, [])

  return (
    <div
      className="flex h-full min-h-0 flex-col"
      data-pdf-viewer
      onKeyDown={(event) => {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
          event.preventDefault()
          setFindOpen(true)
        }
      }}
    >
      <div className="relative flex flex-1 flex-col overflow-hidden">
        {findOpen && <PdfFind eventBus={eventBusRef.current} onClose={() => setFindOpen(false)} />}
        {/* pdf.js needs an absolutely positioned container; `all: revert` keeps Tailwind's preflight out of its DOM. */}
        <div style={{ all: 'revert' }}>
          <div
            ref={containerRef}
            tabIndex={-1}
            style={{ position: 'absolute', inset: '0', overflow: 'auto', background: 'var(--pdf-viewer-bg, #e4e4e7)' }}
            className="scrollbar-sleek dark:[--pdf-viewer-bg:#18181b]"
          >
            <div ref={viewerDivRef} className="pdfViewer" />
          </div>
        </div>
        {error && (
          <div
            role="alert"
            className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-background p-8 text-sm text-muted-foreground"
          >
            <ImageIcon size={40} />
            <div>{error}</div>
            <div className="max-w-md break-all text-center text-xs">{filename}</div>
          </div>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-4 border-t border-border px-4 py-2 text-xs text-muted-foreground">
        <div className="flex items-center gap-1">
          <button
            type="button"
            className="rounded p-1 hover:bg-accent hover:text-foreground disabled:opacity-50"
            onClick={() => stepZoom('out')}
            disabled={scale <= MIN_SCALE}
            title={t('Zoom out')}
            aria-label={t('Zoom out')}
          >
            <ZoomOut size={14} />
          </button>
          <button
            type="button"
            className="rounded p-1 hover:bg-accent hover:text-foreground"
            onClick={() => {
              if (viewerRef.current) viewerRef.current.currentScaleValue = 'page-width'
            }}
            title={t('Fit to width')}
            aria-label={t('Fit to width')}
          >
            <RotateCcw size={14} />
          </button>
          <button
            type="button"
            className="rounded p-1 hover:bg-accent hover:text-foreground disabled:opacity-50"
            onClick={() => stepZoom('in')}
            disabled={scale >= MAX_SCALE}
            title={t('Zoom in')}
            aria-label={t('Zoom in')}
          >
            <ZoomIn size={14} />
          </button>
          <span className="ml-1 tabular-nums" data-pdf-zoom>
            {Math.round(scale * 100)}%
          </span>
        </div>
        <button
          type="button"
          className="rounded p-1 hover:bg-accent hover:text-foreground"
          onClick={() => setFindOpen(true)}
          title={t('Find in PDF (Ctrl+F)')}
          aria-label={t('Find in PDF')}
        >
          <Search size={14} />
        </button>
        <span className="min-w-0 truncate" title={filename}>
          {filename}
        </span>
        <span data-pdf-pages>{pages > 0 ? (pages === 1 ? t('{n} page · PDF preview', { n: pages }) : t('{n} pages · PDF preview', { n: pages })) : t('PDF preview')}</span>
      </div>
    </div>
  )
}

function PdfFind({ eventBus, onClose }: { eventBus: EventBus | null; onClose: () => void }): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [counts, setCounts] = useState<{ current: number; total: number } | null>(null)

  useEffect(() => {
    if (!eventBus) return
    const onCount = (evt: { matchesCount?: { current: number; total: number } }): void => {
      if (evt.matchesCount) setCounts(evt.matchesCount)
    }
    eventBus.on('updatefindmatchescount', onCount)
    eventBus.on('updatefindcontrolstate', onCount)
    return () => {
      eventBus.off('updatefindmatchescount', onCount)
      eventBus.off('updatefindcontrolstate', onCount)
      eventBus.dispatch('findbarclose', { source: null })
    }
  }, [eventBus])

  const find = useCallback(
    (type: string, findPrevious = false): void => {
      if (!query) return
      eventBus?.dispatch('find', {
        source: null,
        type,
        query,
        highlightAll: true,
        caseSensitive: false,
        entireWord: false,
        findPrevious
      })
    },
    [eventBus, query]
  )

  useEffect(() => {
    if (query) find('')
    else setCounts(null)
  }, [query, find])

  return (
    <div className="absolute top-2 right-4 z-10 flex items-center gap-1 rounded-md border border-border bg-popover px-2 py-1 shadow-md">
      <input
        autoFocus
        value={query}
        placeholder={t('Find in PDF')}
        aria-label={t('Find in PDF')}
        className="h-6 w-48 bg-transparent text-xs text-foreground outline-none"
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          event.stopPropagation()
          if (event.key === 'Escape') onClose()
          if (event.key === 'Enter') find('again', event.shiftKey)
        }}
      />
      <span className="min-w-12 text-right text-[11px] tabular-nums text-muted-foreground">
        {query ? (counts && counts.total > 0 ? t('{current} of {total}', { current: counts.current, total: counts.total }) : t('No results')) : ''}
      </span>
      <button type="button" aria-label={t('Previous match')} className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground" onClick={() => find('again', true)}>
        <ChevronUp size={14} />
      </button>
      <button type="button" aria-label={t('Next match')} className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground" onClick={() => find('again')}>
        <ChevronDown size={14} />
      </button>
      <button type="button" aria-label={t('Close find')} className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground" onClick={onClose}>
        <X size={14} />
      </button>
    </div>
  )
}
