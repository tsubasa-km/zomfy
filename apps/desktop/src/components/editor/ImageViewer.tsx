import { Image as ImageIcon, RotateCcw, ZoomIn, ZoomOut } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import {
  type ApplyImageViewerZoomChange,
  applyAnchoredImageViewerZoomChange,
  applyImageSurfaceWheel,
  getElementSurfaceSize,
  getImageLayoutStyle
} from './image-viewer-dom-zoom'
import {
  IMAGE_VIEWER_ZOOM_STEP,
  MAX_IMAGE_VIEWER_ZOOM,
  MIN_IMAGE_VIEWER_ZOOM,
  type ImageViewerImageDimensions,
  type ImageViewerSurfaceSize,
  getZoomedImageLayoutSize
} from './image-viewer-zoom'
import { formatByteSize } from './editor-file-kind'
import { t } from '@/i18n/i18n'

/** Orca's inline ImageViewer: fit-to-pane, zoom buttons, Ctrl+wheel/pinch zoom around the pointer. */
export function ImageViewer({
  base64,
  mimeType,
  filePath,
  size
}: {
  base64: string
  mimeType: string
  filePath: string
  size: number
}): React.JSX.Element {
  const [zoom, setZoom] = useState(1)
  const surfaceRef = useRef<HTMLDivElement | null>(null)
  const [surfaceSize, setSurfaceSize] = useState<ImageViewerSurfaceSize | null>(null)
  const [dimensions, setDimensions] = useState<ImageViewerImageDimensions | null>(null)
  const [failed, setFailed] = useState(false)
  const filename = filePath.split('/').pop() || filePath
  const src = useMemo(() => `data:${mimeType};base64,${base64}`, [mimeType, base64])

  useEffect(() => {
    setZoom(1)
    setDimensions(null)
    setFailed(false)
  }, [src])

  const layoutSize = useMemo(
    () => getZoomedImageLayoutSize({ imageDimensions: dimensions, surfaceSize, zoom }),
    [dimensions, surfaceSize, zoom]
  )
  const applyZoomChange = useCallback<ApplyImageViewerZoomChange>((getNextZoom, anchor) => {
    applyAnchoredImageViewerZoomChange(surfaceRef.current, setZoom, getNextZoom, anchor)
  }, [])

  useEffect(() => {
    const surface = surfaceRef.current
    if (!surface) return
    // Chromium reports trackpad pinch as ctrl-wheel; only a non-passive listener can claim it.
    const onWheel = (event: WheelEvent): void => applyImageSurfaceWheel(event, applyZoomChange)
    const updateSize = (): void => setSurfaceSize(getElementSurfaceSize(surface))
    updateSize()
    surface.addEventListener('wheel', onWheel, { passive: false })
    const observer = new ResizeObserver(updateSize)
    observer.observe(surface)
    return () => {
      surface.removeEventListener('wheel', onWheel)
      observer.disconnect()
    }
  }, [applyZoomChange, failed])

  if (failed) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 bg-muted/20 p-8 text-sm text-muted-foreground">
        <ImageIcon size={40} />
        <div>{t('Failed to load file preview')}</div>
        <div className="max-w-md break-all text-center text-xs">{filename}</div>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col" data-image-viewer>
      <div ref={surfaceRef} className="scrollbar-sleek min-h-0 flex-1 overflow-auto bg-muted/20">
        <div className="flex h-max min-h-full w-max min-w-full items-center justify-center p-4">
          <div className="flex items-center justify-center" style={getImageLayoutStyle(layoutSize)}>
            <img
              src={src}
              alt={filename}
              className={cn(
                'object-contain',
                // Before onLoad, the w-max box makes percentage maxes resolve to none.
                layoutSize ? 'block h-full w-full' : 'block max-h-[100vh] max-w-[100vw]'
              )}
              onLoad={(event) =>
                setDimensions({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })
              }
              onError={() => setFailed(true)}
            />
          </div>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-4 border-t border-border px-4 py-2 text-xs text-muted-foreground">
        <div className="flex items-center gap-1">
          <button
            type="button"
            className="rounded p-1 hover:bg-accent hover:text-foreground disabled:opacity-50"
            onClick={() => applyZoomChange((current) => current / IMAGE_VIEWER_ZOOM_STEP)}
            disabled={zoom <= MIN_IMAGE_VIEWER_ZOOM}
            title={t('Zoom out')}
            aria-label={t('Zoom out')}
          >
            <ZoomOut size={14} />
          </button>
          <button
            type="button"
            className="rounded p-1 hover:bg-accent hover:text-foreground disabled:opacity-50"
            onClick={() => applyZoomChange(() => 1)}
            disabled={zoom === 1}
            title={t('Reset zoom')}
            aria-label={t('Reset zoom')}
          >
            <RotateCcw size={14} />
          </button>
          <button
            type="button"
            className="rounded p-1 hover:bg-accent hover:text-foreground disabled:opacity-50"
            onClick={() => applyZoomChange((current) => current * IMAGE_VIEWER_ZOOM_STEP)}
            disabled={zoom >= MAX_IMAGE_VIEWER_ZOOM}
            title={t('Zoom in')}
            aria-label={t('Zoom in')}
          >
            <ZoomIn size={14} />
          </button>
          <span className="ml-1 tabular-nums" data-image-zoom>
            {Math.round(zoom * 100)}%
          </span>
        </div>
        <span className="min-w-0 truncate" title={filename}>
          {filename}
        </span>
        {dimensions && (
          <span>
            {dimensions.width} x {dimensions.height}
          </span>
        )}
        <span>{formatByteSize(size)}</span>
      </div>
    </div>
  )
}
