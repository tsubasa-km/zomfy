import { cloudflareTest } from '@cloudflare/vitest-plugin'
import { defineConfig } from 'vitest/config'

// Tests run inside workerd with the Worker's own wrangler config. The setup code is a marker, so
// the secret-leak test can look for it in storage.
export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: { bindings: { SETUP_CODE: 'marker-setup-code-7f3a', DISCORD_PUBLIC_KEY: '' } }
    })
  ],
  test: { include: ['test/**/*.test.ts'] }
})
