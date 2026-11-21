import { memo, useEffect, useRef } from 'react'
import { NativeChatTranscriptRow, type TranscriptRowActions } from './NativeChatTranscriptRow'
import type { TranscriptRowModel } from './native-chat-transcript-model'

/** Rows per block. A streamed chunk renders the last block's rows; the other blocks are skipped whole. */
const BLOCK_ROWS = 25

type RowsProps = {
  rows: TranscriptRowModel[]
  sessionId: string
  actions: TranscriptRowActions
  /** The row offering Continue or Retry, which gets `recoveryActions`; -1 for none. */
  recoveryRow: number
  recoveryActions: TranscriptRowActions
}

/**
 * The transcript's rows in fixed blocks by index. A long chat has hundreds of rows, and a
 * streamed chunk changes only the last few: one element per block, rather than per row, is made
 * on each chunk, and a block whose rows are all the same objects as before is not rendered.
 */
export function NativeChatTranscriptRows(props: RowsProps) {
  const blocks: React.ReactNode[] = []
  for (let start = 0; start < props.rows.length; start += BLOCK_ROWS) blocks.push(<TranscriptBlock key={start} start={start} {...props} />)
  return blocks
}

type BlockProps = RowsProps & { start: number }

function blockEnd({ rows, start }: BlockProps): number {
  return Math.min(rows.length, start + BLOCK_ROWS)
}

/** The block's row that offers recovery, or -1. */
function recoveryIn(props: BlockProps): number {
  return props.recoveryRow >= props.start && props.recoveryRow < blockEnd(props) ? props.recoveryRow : -1
}

function sameBlock(prev: BlockProps, next: BlockProps): boolean {
  const end = blockEnd(next)
  if (
    prev.start !== next.start ||
    prev.sessionId !== next.sessionId ||
    prev.actions !== next.actions ||
    blockEnd(prev) !== end ||
    recoveryIn(prev) !== recoveryIn(next) ||
    (recoveryIn(next) !== -1 && prev.recoveryActions !== next.recoveryActions)
  ) {
    return false
  }
  for (let i = next.start; i < end; i++) if (prev.rows[i] !== next.rows[i]) return false
  return true
}

const TranscriptBlock = memo(function TranscriptBlock(props: BlockProps) {
  const { rows, start, sessionId, actions, recoveryActions } = props
  const recovery = recoveryIn(props)
  const out: React.ReactNode[] = []
  for (let index = start; index < blockEnd(props); index++) {
    out.push(
      <NativeChatTranscriptRow
        key={index}
        row={rows[index]!}
        rowKey={`${sessionId}:${index}`}
        actions={index === recovery ? recoveryActions : actions}
      />
    )
  }
  return <SkippableBlock>{out}</SkippableBlock>
}, sameBlock)

/**
 * A block the browser may skip laying out and painting while it is off screen
 * (content-visibility), which keeps a long chat's per-chunk layout to the blocks in view. It
 * becomes skippable only after it has been laid out at its width, so the browser holds its real
 * size (contain-intrinsic-size: auto) rather than a guess, and the transcript's height and scroll
 * positions stay exact. Find, selection and the message rail read the DOM, which is all there.
 */
function SkippableBlock({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const element = ref.current
    if (!element) return
    let frame = 0
    // The size is recorded after a frame's layout, which runs after its animation callbacks: a
    // callback in the frame after comes once the block has been laid out at its width.
    const skipLater = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        frame = requestAnimationFrame(() => {
          element.style.contentVisibility = 'auto'
        })
      })
    }
    let width: number | null = null
    // A new width rewraps the text, so a skipped block's kept height would be wrong: it is laid
    // out again (for a frame) before it may be skipped again.
    const observer = new ResizeObserver(([entry]) => {
      const next = Math.round(entry?.contentRect.width ?? 0)
      if (next === width) return
      if (width !== null) element.style.contentVisibility = 'visible'
      width = next
      skipLater()
    })
    observer.observe(element)
    return () => {
      observer.disconnect()
      cancelAnimationFrame(frame)
    }
  }, [])
  return (
    <div ref={ref} data-native-chat-block className="flex flex-col gap-5 [contain-intrinsic-size:auto_1500px]">
      {children}
    </div>
  )
}
