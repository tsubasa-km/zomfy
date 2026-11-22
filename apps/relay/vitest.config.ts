import { cloudflareTest } from '@cloudflare/vitest-plugin'
import { defineConfig } from 'vitest/config'

// Tests run inside workerd with the Worker's own wrangler config. Secrets are markers, so the
// secret-leak test can look for them in storage. Discord is configured with a test key pair and
// reached through a fake Discord (test/fake-discord.mjs) bound as DISCORD_TRANSPORT.
export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: {
        bindings: {
          SETUP_CODE: 'marker-setup-code-7f3a',
          DISCORD_APPLICATION_ID: '1000',
          DISCORD_PUBLIC_KEY: '351eb0a069733c73bb2f368dae44b22cbe63ccecc07bc9f32c22cd6c0b14fcca',
          DISCORD_BOT_TOKEN: 'marker-discord-token-91c2'
        },
        serviceBindings: { DISCORD_TRANSPORT: 'fake-discord' },
        workers: [
          {
            name: 'fake-discord',
            modules: true,
            scriptPath: './test/fake-discord.mjs',
            compatibilityDate: '2026-08-01',
            durableObjects: { FAKE: 'FakeDiscord' }
          }
        ]
      }
    })
  ],
  test: { include: ['test/**/*.test.ts'] }
})
