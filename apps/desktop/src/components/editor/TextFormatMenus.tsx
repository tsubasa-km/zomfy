import { TriangleAlert } from 'lucide-react'
import { TEXT_ENCODINGS, type TextEncoding } from '@acp-harness/protocol'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { t } from '@/i18n/i18n'
import type { TextFormat } from './document-transfer'
import { editorStatusButtonClass } from './EditorStatus'

// The status bar's encoding and line-ending buttons: what the file is in, and the menus that reopen it
// in another encoding, save it in another, or change its line endings.

const ENCODING_NAMES: Record<TextEncoding, string> = {
  utf8: 'UTF-8',
  utf16le: 'UTF-16 LE',
  utf16be: 'UTF-16 BE',
  shiftjis: 'Shift_JIS',
  eucjp: 'EUC-JP',
  windows1252: 'Windows-1252',
  gb18030: 'GB18030',
  big5: 'Big5',
  euckr: 'EUC-KR'
}

/** The region an encoding's name does not already say, for the menus. */
function encodingHint(encoding: TextEncoding): string | null {
  switch (encoding) {
    case 'shiftjis':
    case 'eucjp':
      return t('Japanese')
    case 'windows1252':
      return t('Western')
    case 'gb18030':
      return t('Simplified Chinese')
    case 'big5':
      return t('Traditional Chinese')
    case 'euckr':
      return t('Korean')
    default:
      return null
  }
}

function hasBom(encoding: TextEncoding): boolean {
  return encoding === 'utf8' || encoding === 'utf16le' || encoding === 'utf16be'
}

export function formatLabel(format: TextFormat): string {
  const name = ENCODING_NAMES[format.encoding]
  if (format.encoding === 'utf8') return format.bom ? t('UTF-8 with BOM') : name
  return hasBom(format.encoding) && !format.bom ? t('{encoding} (no BOM)', { encoding: name }) : name
}

/** What "save with encoding" offers: UTF-16 with its mark, UTF-8 either way, the rest as they are. */
const SAVE_FORMATS: TextFormat[] = TEXT_ENCODINGS.flatMap((encoding): TextFormat[] =>
  encoding === 'utf8' ? [{ encoding, bom: false }, { encoding, bom: true }] : [{ encoding, bom: hasBom(encoding) }]
)

const formatKey = (format: TextFormat): string => `${format.encoding}:${format.bom}`
const buttonClass = editorStatusButtonClass

function MenuEncoding({ format }: { format: TextFormat }): React.JSX.Element {
  const hint = encodingHint(format.encoding)
  return (
    <>
      {format.encoding === 'utf8' && format.bom ? t('UTF-8 with BOM') : ENCODING_NAMES[format.encoding]}
      {hint && <span className="ml-auto pl-4 text-muted-foreground">{hint}</span>}
    </>
  )
}

export function EncodingMenu({
  format,
  malformed,
  onReopen,
  onSaveAs
}: {
  format: TextFormat
  /** Some of the file's bytes are not valid in `format`. */
  malformed: boolean
  /** Read the file again as `encoding`; null detects. */
  onReopen: (encoding: TextEncoding | null) => void
  /** Absent where the file cannot be saved (a read-only view, an older host). */
  onSaveAs?: (format: TextFormat) => void
}): React.JSX.Element {
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={buttonClass}
          data-editor-encoding={format.encoding}
          title={malformed ? t('Some bytes are not valid {encoding}; they show as �. Try reopening with another encoding.', { encoding: formatLabel(format) }) : t('File encoding')}
        >
          <span className="flex items-center gap-1">
            {malformed && <TriangleAlert className="size-3 text-status-warning" />}
            {formatLabel(format)}
          </span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={4} className="min-w-48">
        <DropdownMenuSub>
          <DropdownMenuSubTrigger data-encoding-menu="reopen">{t('Reopen with Encoding')}</DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuItem onSelect={() => onReopen(null)}>{t('Detect Automatically')}</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuRadioGroup value={format.encoding} onValueChange={(value) => onReopen(value as TextEncoding)}>
              {TEXT_ENCODINGS.map((encoding) => (
                <DropdownMenuRadioItem key={encoding} value={encoding} data-reopen-encoding={encoding}>
                  <MenuEncoding format={{ encoding, bom: false }} />
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        {onSaveAs && (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger data-encoding-menu="save">{t('Save with Encoding')}</DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuRadioGroup
                value={formatKey(format)}
                onValueChange={(value) => {
                  const next = SAVE_FORMATS.find((candidate) => formatKey(candidate) === value)
                  if (next) onSaveAs(next)
                }}
              >
                {SAVE_FORMATS.map((candidate) => (
                  <DropdownMenuRadioItem key={formatKey(candidate)} value={formatKey(candidate)} data-save-encoding={formatKey(candidate)}>
                    <MenuEncoding format={candidate} />
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export type LineEnding = 'LF' | 'CRLF'

export function LineEndingMenu({ value, onChange }: { value: LineEnding; onChange?: (next: LineEnding) => void }): React.JSX.Element {
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button type="button" className={buttonClass} disabled={!onChange} data-editor-eol={value} title={t('Line endings')}>
          {value}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={4}>
        <DropdownMenuRadioGroup value={value} onValueChange={(next) => onChange?.(next as LineEnding)}>
          <DropdownMenuRadioItem value="LF">LF</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="CRLF">CRLF</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
