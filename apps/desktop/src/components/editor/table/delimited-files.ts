import { fileExtension } from '../editor-file-kind'
import type { Delimiter } from './delimited-scan'

// Which files are delimited text, and the delimiter each extension suggests. The file's content
// has the last word (sniffDelimiter); the extension settles a tie.
const EXTENSIONS: Record<string, Delimiter> = {
  csv: ',',
  tsv: '\t',
  tab: '\t',
  psv: '|',
  ssv: ';',
  dsv: ','
}

/** The delimiter a path's extension suggests, or null when the file is not delimited text. */
export function delimiterForPath(path: string): Delimiter | null {
  return EXTENSIONS[fileExtension(path)] ?? null
}
