// Imported first by main.tsx, so legacy keys are renamed (and paths under the legacy home rewritten)
// before any store module reads its key.
import { migrateLegacyStorage, rewriteLegacyHomePaths } from './legacy-storage'

try {
  migrateLegacyStorage(localStorage)
  migrateLegacyStorage(sessionStorage)
  rewriteLegacyHomePaths(localStorage)
  rewriteLegacyHomePaths(sessionStorage)
} catch {
  // No storage (a sandboxed frame): nothing to migrate.
}
