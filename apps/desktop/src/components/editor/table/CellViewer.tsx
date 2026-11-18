import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { t } from '@/i18n/i18n'
import type { TableSource } from './delimited-client'

/** One cell in full: the grid shows a single line of it, and cuts very long values short. */
export function CellViewer({
  source,
  row,
  column,
  columnName,
  onShowInSource,
  onClose
}: {
  source: TableSource
  /** Row of the view on screen. */
  row: number
  column: number
  columnName: string
  onShowInSource: () => void
  onClose: () => void
}): React.JSX.Element {
  const [cell, setCell] = useState<{ value: string | null } | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let gone = false
    void source.call({ op: 'cell', row, column }).then((value) => {
      if (!gone) setCell({ value })
    })
    return () => {
      gone = true
    }
  }, [source, row, column])

  const value = cell?.value ?? null
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="gap-3 sm:max-w-2xl" data-cell-viewer>
        <DialogHeader>
          <DialogTitle className="text-sm">{columnName}</DialogTitle>
          <DialogDescription className="text-xs">
            {cell === null
              ? t('Loading…')
              : value === null
                ? t('This row has no field in this column.')
                : value.length === 1
                  ? t('1 character')
                  : t('{count} characters', { count: value.length.toLocaleString() })}
          </DialogDescription>
        </DialogHeader>
        <pre className="scrollbar-sleek max-h-[60vh] min-h-16 overflow-auto rounded-md border border-border bg-muted/40 p-3 font-mono text-xs break-words whitespace-pre-wrap select-text">
          {value ?? ''}
        </pre>
        <DialogFooter>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              onShowInSource()
              onClose()
            }}
          >
            {t('Show in Source')}
          </Button>
          <Button
            size="sm"
            disabled={value === null}
            onClick={() => {
              if (value === null) return
              void navigator.clipboard.writeText(value).then(() => {
                setCopied(true)
                window.setTimeout(() => setCopied(false), 1400)
              })
            }}
          >
            {copied ? t('Copied') : t('Copy')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
