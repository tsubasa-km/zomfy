import { setDefaultTimeout } from 'bun:test'

// bun's 5 s default fails tests that drive real git (finishWorktree, SplitCoordinator) whenever
// Windows is slow to spawn processes, on CI and on a busy machine alike. A hung test still fails.
setDefaultTimeout(30_000)
