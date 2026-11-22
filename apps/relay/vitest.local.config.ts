import { defineConfig } from 'vitest/config'

// The local launcher's tests (`bun run relay:local`, docs/specs/bots/self-host.md) run in Node, not
// workerd: they check scripts/local-lib.mjs and start scripts/local.mjs for real on 127.0.0.1.
export default defineConfig({
  test: {
    include: ['test/local/**/*.test.mjs'],
    environment: 'node',
    testTimeout: 240_000,
    hookTimeout: 240_000,
    fileParallelism: false
  }
})
