import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { cloudflareTest } from '@cloudflare/vitest-plugin'
import { defineConfig } from 'vitest/config'

// Tests run inside workerd with the Worker's own wrangler config. Secrets are markers, so the
// secret-leak tests can look for them in storage. Discord is configured with a test key pair and
// reached through a fake Discord (test/fake-discord.mjs) bound as DISCORD_TRANSPORT; Slack, GitHub
// and Linear through fake APIs (test/fake-apis.mjs) bound as SOURCES_TRANSPORT. The GitHub App key
// is a throwaway made for these tests only.
export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: {
        bindings: {
          SETUP_CODE: 'marker-setup-code-7f3a',
          DISCORD_APPLICATION_ID: '1000',
          DISCORD_PUBLIC_KEY: '351eb0a069733c73bb2f368dae44b22cbe63ccecc07bc9f32c22cd6c0b14fcca',
          DISCORD_BOT_TOKEN: 'marker-discord-token-91c2',
          SLACK_BOT_TOKEN: 'xoxb-marker-slack-token-77d0',
          SLACK_SIGNING_SECRET: 'marker-slack-signing-5e1a',
          GITHUB_APP_ID: '424242',
          GITHUB_APP_SLUG: 'zomfy-test',
          GITHUB_APP_PRIVATE_KEY: readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'test', 'github-test-key.pem'), 'utf8'),
          GITHUB_WEBHOOK_SECRET: 'marker-github-hook-3b9c',
          LINEAR_ACCESS_TOKEN: 'marker-linear-token-c4d1',
          LINEAR_WEBHOOK_SECRET: 'marker-linear-hook-0a2f'
        },
        serviceBindings: { DISCORD_TRANSPORT: 'fake-discord', SOURCES_TRANSPORT: 'fake-apis' },
        workers: [
          {
            name: 'fake-discord',
            modules: true,
            scriptPath: './test/fake-discord.mjs',
            compatibilityDate: '2026-08-01',
            durableObjects: { FAKE: 'FakeDiscord' }
          },
          {
            name: 'fake-apis',
            modules: true,
            scriptPath: './test/fake-apis.mjs',
            compatibilityDate: '2026-08-01',
            durableObjects: { FAKE: 'FakeApis' }
          }
        ]
      }
    })
  ],
  test: { include: ['test/**/*.test.ts'] }
})
