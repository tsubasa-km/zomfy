import { rename } from 'node:fs/promises'

// On Windows a file that something else has open for a moment (a virus scanner, the search
// indexer, a reader) refuses to be replaced; a short wait usually clears it.

const BUSY = new Set(['EPERM', 'EBUSY', 'EACCES'])

/** Moves `temp` over `target`, retrying briefly while the target is held open. */
export async function replaceFile(temp: string, target: string): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await rename(temp, target)
      return
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : ''
      if (!BUSY.has(code) || attempt >= 8) throw error
      await Bun.sleep(25 * attempt)
    }
  }
}
