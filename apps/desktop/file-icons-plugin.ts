import { createRequire } from 'node:module'
import { readFile, readdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { Plugin } from 'vite'
import { compactIconRules, type IconThemeManifest } from './src/lib/file-icons/icon-rules'

// Material Icon Theme (MIT) for the file explorer: its SVGs are served as they are under
// /file-icons/, and its rules reach the app as the module "virtual:file-icon-rules".

const RULES_ID = 'virtual:file-icon-rules'
const ICONS_URL = '/file-icons/'

export function fileIcons(): Plugin {
  const require = createRequire(import.meta.url)
  const packageDir = dirname(require.resolve('material-icon-theme/package.json'))
  const iconsDir = join(packageDir, 'icons')

  return {
    name: 'file-icons',
    resolveId: (id) => (id === RULES_ID ? `\0${RULES_ID}` : undefined),
    load(id) {
      if (id !== `\0${RULES_ID}`) return undefined
      const { generateManifest } = require('material-icon-theme') as { generateManifest: () => IconThemeManifest }
      return `export default ${JSON.stringify(compactIconRules(generateManifest()))}`
    },
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        const path = (request.url ?? '').split('?')[0]!
        if (!path.startsWith(ICONS_URL)) return next()
        const name = path.slice(ICONS_URL.length)
        if (!/^[\w.-]+\.svg$/.test(name)) return next()
        try {
          const svg = await readFile(join(iconsDir, name))
          response.setHeader('Content-Type', 'image/svg+xml')
          response.setHeader('Cache-Control', 'max-age=86400')
          response.end(svg)
        } catch {
          next()
        }
      })
    },
    async generateBundle() {
      for (const name of await readdir(iconsDir)) {
        if (!name.endsWith('.svg')) continue
        this.emitFile({ type: 'asset', fileName: `${ICONS_URL.slice(1)}${name}`, source: await readFile(join(iconsDir, name)) })
      }
    }
  }
}
