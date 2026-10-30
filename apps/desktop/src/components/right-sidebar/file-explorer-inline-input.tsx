import { useCallback, useEffect, useRef } from 'react'
import { File, Folder } from 'lucide-react'
import { isImeCompositionKeyDown, useImeEnterGestureOwnership } from '@/lib/ime-composition-keyboard-event'
import { t } from '@/i18n/i18n'

// Orca's file-explorer-inline-input-row: Enter commits, Escape cancels, blur commits after a grace
// period (menu-close focus restore can briefly steal focus), rename preselects the stem.

export type InlineInput =
  | { type: 'file' | 'folder'; parentDir: string; depth: number }
  | { type: 'rename'; path: string; name: string; isDir: boolean; depth: number }

export function InlineInputRow({
  input,
  onSubmit,
  onCancel
}: {
  input: InlineInput
  onSubmit: (value: string) => void
  onCancel: () => void
}) {
  const ref = useRef<HTMLInputElement>(null)
  const done = useRef(false)
  const settled = useRef(false)
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const ime = useImeEnterGestureOwnership()

  useEffect(() => {
    done.current = false
    settled.current = false
    const frame = requestAnimationFrame(() => {
      const el = ref.current
      if (!el) return
      el.focus()
      if (input.type === 'rename') {
        const dot = input.isDir ? -1 : input.name.lastIndexOf('.')
        if (dot > 0) el.setSelectionRange(0, dot)
        else el.select()
      }
    })
    const settle = setTimeout(() => (settled.current = true), 200)
    return () => {
      cancelAnimationFrame(frame)
      clearTimeout(settle)
      if (blurTimer.current) clearTimeout(blurTimer.current)
    }
  }, [input])

  const submit = useCallback(
    (value: string) => {
      if (done.current) return
      done.current = true
      if (blurTimer.current) clearTimeout(blurTimer.current)
      onSubmit(value)
    },
    [onSubmit]
  )

  const isFolder = input.type === 'folder' || (input.type === 'rename' && input.isDir)
  return (
    <div className="flex h-[26px] w-full items-center gap-1 px-2" style={{ paddingLeft: `${input.depth * 16 + 8}px` }}>
      <span className="size-3 shrink-0" />
      {isFolder ? (
        <Folder className="size-3 shrink-0 text-muted-foreground" />
      ) : (
        <File className="size-3 shrink-0 text-muted-foreground" />
      )}
      <input
        ref={ref}
        data-file-explorer-inline-input=""
        aria-label={input.type === 'rename' ? t('Rename {name}', { name: input.name }) : input.type === 'folder' ? t('New folder name') : t('New file name')}
        spellCheck={false}
        className="min-w-0 flex-1 rounded-sm border border-ring bg-transparent px-1 text-xs text-foreground outline-none"
        defaultValue={input.type === 'rename' ? input.name : ''}
        onKeyDown={(e) => {
          e.stopPropagation()
          // A CJK confirm Enter arrives twice and only the first is marked.
          if (ime.ownsKeyDown(e) || ime.isComposing() || isImeCompositionKeyDown(e)) return
          if (e.key === 'Enter') {
            e.preventDefault()
            submit(e.currentTarget.value)
          } else if (e.key === 'Escape') {
            e.preventDefault()
            done.current = true
            onCancel()
          }
        }}
        onKeyUp={ime.onKeyUp}
        onCompositionStart={() => ime.setComposing(true)}
        onCompositionEnd={ime.onCompositionEnd}
        onFocus={() => blurTimer.current && clearTimeout(blurTimer.current)}
        onBlur={(e) => {
          ime.reset()
          if (!settled.current) {
            requestAnimationFrame(() => !done.current && ref.current?.focus())
            return
          }
          const value = e.currentTarget.value
          blurTimer.current = setTimeout(() => submit(value), 150)
        }}
      />
    </div>
  )
}
