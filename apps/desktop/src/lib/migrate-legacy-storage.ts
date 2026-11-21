// Imported first by main.tsx, so legacy keys are renamed before any store module reads its key.
import { migrateLegacyStorage } from './legacy-storage'

try {
  migrateLegacyStorage(localStorage)
  migrateLegacyStorage(sessionStorage)
} catch {
  // No storage (a sandboxed frame): nothing to migrate.
}
