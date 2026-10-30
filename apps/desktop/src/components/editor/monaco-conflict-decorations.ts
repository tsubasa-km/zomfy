import type { editor, IRange } from 'monaco-editor'
import { t } from '@/i18n/i18n'

// Ported from Orca's monaco-conflict-decorations.ts; the accept actions are this port's addition.

export type ConflictBlock = {
  startLine: number
  baseLine?: number
  separatorLine: number
  endLine: number
}

type ParsedConflictBlock = ConflictBlock & {
  startText: string
  baseText?: string
  endText: string
}

type ConflictSection = 'current' | 'base' | 'incoming'
export type ConflictChoice = 'current' | 'incoming' | 'both'

function parseGitConflictBlocks(content: string): ParsedConflictBlock[] {
  const blocks: ParsedConflictBlock[] = []
  let current: Partial<ParsedConflictBlock> | null = null
  const lines = content.split(/\r?\n/)
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]
    const lineNumber = index + 1
    if (line.startsWith('<<<<<<<')) {
      current = { startLine: lineNumber, startText: line }
      continue
    }
    if (!current) continue
    if (line.startsWith('|||||||')) {
      current.baseLine = lineNumber
      current.baseText = line
    } else if (line === '=======') {
      current.separatorLine = lineNumber
    } else if (line.startsWith('>>>>>>>')) {
      if (current.startLine !== undefined && current.separatorLine !== undefined) {
        blocks.push({
          startLine: current.startLine,
          startText: current.startText ?? '',
          baseLine: current.baseLine,
          baseText: current.baseText,
          separatorLine: current.separatorLine,
          endLine: lineNumber,
          endText: line
        })
      }
      current = null
    }
  }
  return blocks
}

export function findGitConflictBlocks(content: string): ConflictBlock[] {
  return parseGitConflictBlocks(content).map(({ startLine, baseLine, separatorLine, endLine }) => ({
    startLine,
    ...(baseLine === undefined ? {} : { baseLine }),
    separatorLine,
    endLine
  }))
}

export function hasGitConflictMarkers(content: string): boolean {
  return findGitConflictBlocks(content).length > 0
}

function makeMarkerDecoration(lineNumber: number, line: string, label: string): editor.IModelDeltaDecoration {
  return {
    range: { startLineNumber: lineNumber, startColumn: 1, endLineNumber: lineNumber, endColumn: line.length + 1 },
    options: {
      isWholeLine: true,
      className: 'orca-conflict-marker-line',
      linesDecorationsClassName: 'orca-conflict-line-decoration',
      marginClassName: 'orca-conflict-margin',
      hoverMessage: { value: label },
      after: { content: ` ${label}`, inlineClassName: 'orca-conflict-marker-label' }
    }
  }
}

function makeSectionDecoration(
  startLineNumber: number,
  endLineNumber: number,
  section: ConflictSection
): editor.IModelDeltaDecoration | null {
  if (startLineNumber > endLineNumber) return null
  return {
    range: { startLineNumber, startColumn: 1, endLineNumber, endColumn: 1 },
    options: { isWholeLine: true, className: `orca-conflict-section-line orca-conflict-${section}-line` }
  }
}

export function buildGitConflictDecorations(content: string): editor.IModelDeltaDecoration[] {
  const decorations: editor.IModelDeltaDecoration[] = []
  for (const block of parseGitConflictBlocks(content)) {
    const currentEndLine = (block.baseLine ?? block.separatorLine) - 1
    const sections = [
      makeSectionDecoration(block.startLine + 1, currentEndLine, 'current'),
      block.baseLine ? makeSectionDecoration(block.baseLine + 1, block.separatorLine - 1, 'base') : null,
      makeSectionDecoration(block.separatorLine + 1, block.endLine - 1, 'incoming')
    ]
    for (const decoration of sections) if (decoration) decorations.push(decoration)
    decorations.push(
      makeMarkerDecoration(block.startLine, block.startText, t('Current change')),
      ...(block.baseLine ? [makeMarkerDecoration(block.baseLine, block.baseText ?? '', t('Common ancestor'))] : []),
      makeMarkerDecoration(block.separatorLine, '=======', t('Incoming change')),
      makeMarkerDecoration(block.endLine, block.endText, t('End conflict'))
    )
  }
  return decorations
}

/** The edit that replaces one conflict block with the chosen side(s), markers included. */
export function buildConflictResolutionEdit(
  model: editor.ITextModel,
  block: ConflictBlock,
  choice: ConflictChoice
): { range: IRange; text: string } {
  const lines = (from: number, to: number): string[] => {
    const out: string[] = []
    for (let line = from; line <= to; line++) out.push(model.getLineContent(line))
    return out
  }
  const current = lines(block.startLine + 1, (block.baseLine ?? block.separatorLine) - 1)
  const incoming = lines(block.separatorLine + 1, block.endLine - 1)
  const kept = choice === 'current' ? current : choice === 'incoming' ? incoming : [...current, ...incoming]
  const eol = model.getEOL()
  const isLastLine = block.endLine >= model.getLineCount()
  const range: IRange = isLastLine
    ? {
        startLineNumber: block.startLine,
        startColumn: 1,
        endLineNumber: block.endLine,
        endColumn: model.getLineMaxColumn(block.endLine)
      }
    : { startLineNumber: block.startLine, startColumn: 1, endLineNumber: block.endLine + 1, endColumn: 1 }
  const text = kept.length === 0 ? '' : kept.join(eol) + (isLastLine ? '' : eol)
  return { range, text }
}
