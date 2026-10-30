import { cn } from '@/lib/utils'
import { ImageViewer } from './ImageViewer'
import { t, tc } from '@/i18n/i18n'

function ImageDiffPane({
  label,
  base64,
  filePath,
  mimeType
}: {
  label: string
  base64: string | null
  filePath: string
  mimeType: string
}): React.JSX.Element {
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-md bg-muted/10" data-image-diff-pane={label}>
      <div className="px-3 py-2 text-xs font-medium text-muted-foreground">{tc(label, 'diff side')}</div>
      {base64 ? (
        <div className="min-h-0 flex-1">
          <ImageViewer base64={base64} mimeType={mimeType} filePath={filePath} size={Math.floor((base64.length * 3) / 4)} />
        </div>
      ) : (
        <div className="flex flex-1 items-center justify-center bg-muted/20 p-6 text-sm text-muted-foreground">{t('No preview')}</div>
      )}
    </div>
  )
}

/** Orca's ImageDiffViewer: original and modified images in columns, or stacked when inline. */
export function ImageDiffViewer({
  original,
  modified,
  filePath,
  mimeType,
  sideBySide
}: {
  original: string | null
  modified: string | null
  filePath: string
  mimeType: string
  sideBySide: boolean
}): React.JSX.Element {
  // Stacked panes keep a usable height and scroll instead of squeezing into half the panel.
  const gridRowStyle = sideBySide
    ? undefined
    : { gridTemplateRows: `${original ? 'minmax(32rem, 1fr)' : 'auto'} ${modified ? 'minmax(32rem, 1fr)' : 'auto'}` }
  return (
    <div
      className={cn('grid h-full min-h-0 gap-3 p-3', sideBySide ? 'grid-cols-2' : 'scrollbar-sleek grid-cols-1 overflow-y-auto')}
      style={gridRowStyle}
    >
      <ImageDiffPane label="Original" base64={original} filePath={filePath} mimeType={mimeType} />
      <ImageDiffPane label="Modified" base64={modified} filePath={filePath} mimeType={mimeType} />
    </div>
  )
}
