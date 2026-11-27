import { describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildFeedbackMarkdown, isFeedbackShortcut, buildFeedbackSummary, bundleFolderName, repoRelativePath, type FeedbackPayload } from '../src/dev/feedback/bundle.ts'
import { writeFeedbackBundle } from '../feedback-plugin.ts'
import { sameView } from '../src/dev/feedback/views.ts'

// docs/specs/dev-feedback-overlay.md

const repo = 'C:\\repo'
const vite = 'C:\\repo\\apps\\desktop'

const payload: FeedbackPayload = {
  context: {
    at: '2026-11-27T09:30:12.345Z',
    url: 'http://localhost:1433/',
    title: 'Zomfy',
    theme: 'dark',
    viewport: { width: 1280, height: 800, dpr: 1 },
    windowRole: 'main',
    selectedTabs: ['Fix the sidebar'],
    focused: null,
  },
  pins: [
    {
      n: 1,
      kind: 'element',
      comment: 'Too low',
      selector: '[data-thread-row]',
      component: 'ThreadRow',
      source: { file: 'http://localhost:1433/src/components/ThreadRow.tsx?t=1', line: 42, column: 7 },
      stack: [{ name: 'Sidebar', source: { file: '/src/components/Sidebar.tsx', line: 10, column: null } }],
      tag: 'div',
      text: '  Fix   the sidebar ',
      box: { x: 10.4, y: 20, width: 200, height: 28 },
      styles: 'color: red;',
      view: 1,
      onOverview: false,
      crop: true,
    },
  ],
  drawings: [
    { n: 2, kind: 'arrow', comment: 'Move it here', points: [[100, 100], [300, 120]], view: 1, onOverview: false },
    { n: 3, kind: 'rect', comment: 'Settings row', points: [[10, 10], [50, 30]], view: 2, onOverview: true },
  ],
  views: [
    { n: 1, marks: [1, 2] },
    { n: 2, marks: [3] },
  ],
}

describe('dev feedback overlay', () => {
  test('source paths become relative to the repository', () => {
    expect(repoRelativePath('http://localhost:1433/src/App.tsx?t=123', vite, repo)).toBe('apps/desktop/src/App.tsx')
    expect(repoRelativePath('/src/App.tsx', vite, repo)).toBe('apps/desktop/src/App.tsx')
    expect(repoRelativePath('/@fs/C:/repo/packages/protocol/src/index.ts', vite, repo)).toBe('packages/protocol/src/index.ts')
    expect(repoRelativePath('file:///C:/repo/apps/desktop/src/x.tsx', vite, repo)).toBe('apps/desktop/src/x.tsx')
    expect(repoRelativePath('C:\\elsewhere\\y.ts', vite, repo)).toBe('C:/elsewhere/y.ts')
  })

  test('Ctrl+Shift+. (or Cmd+Shift+.) is the toggle, by key position', () => {
    const key = { code: 'Period', ctrlKey: true, metaKey: false, shiftKey: true, altKey: false }
    expect(isFeedbackShortcut(key)).toBe(true)
    expect(isFeedbackShortcut({ ...key, ctrlKey: false, metaKey: true })).toBe(true)
    expect(isFeedbackShortcut({ ...key, shiftKey: false })).toBe(false)
    expect(isFeedbackShortcut({ ...key, altKey: true })).toBe(false)
    expect(isFeedbackShortcut({ ...key, code: 'Comma' })).toBe(false)
  })

  test('one view: same URL, same open layers and most of the grid showing the same elements', () => {
    const print = { url: 'http://localhost/', cells: Array.from({ length: 48 }, (_, i) => i + 1), layers: [] as number[] }
    const someMoved = { ...print, cells: print.cells.map((cell, i) => (i < 10 ? 0 : cell)) }
    const mostMoved = { ...print, cells: print.cells.map((cell, i) => (i < 20 ? 0 : cell)) }
    expect(sameView(print, someMoved)).toBe(true)
    expect(sameView(print, mostMoved)).toBe(false)
    expect(sameView(print, { ...print, layers: [7] })).toBe(false)
    expect(sameView(print, { ...print, url: 'http://localhost/?window=dashboard' })).toBe(false)
  })

  test('a bundle folder name sorts by time and has no colons', () => {
    expect(bundleFolderName(new Date('2026-11-27T09:30:12.345Z'))).toBe('2026-11-27T09-30-12-345Z')
  })

  test('the Markdown lists marks in number order with component, source and comment', () => {
    const markdown = buildFeedbackMarkdown(payload, 'C:\\tmp\\fb')
    expect(markdown).toContain('Folder: `C:/tmp/fb`')
    expect(markdown).toContain('- `screenshot-1.png`: the screen when marks 1, 2 were made, with them drawn')
    expect(markdown).toContain('- `screenshot-2.png`: the screen when mark 3 was made, with it drawn')
    expect(markdown).toContain('- `screenshot.png`: the screen at send time, with mark 3 (those still on it)')
    expect(markdown).toContain('- Shot: `screenshot-1.png`\n- Crop: `element-1.png`')
    expect(markdown).toContain('- Shot: `screenshot-2.png`, also on `screenshot.png`')
    expect(markdown).toContain('Selected tabs: "Fix the sidebar"')
    expect(markdown).toContain('## 1. Element: Too low')
    expect(markdown).toContain('Text: "Fix the sidebar"')
    expect(markdown).toContain('## 2. Drawing: Move it here')
    expect(markdown).toContain('arrow from (100, 100) to (300, 120)')
    expect(markdown.indexOf('## 1.')).toBeLessThan(markdown.indexOf('## 2.'))
  })

  test('the summary has the folder and one line per mark', () => {
    const summary = buildFeedbackSummary(payload, '/tmp/fb')
    expect(summary.split('\n')).toEqual([
      'UI feedback: `/tmp/fb` (read `feedback.md` and look at the screenshots it names)',
      '1. `ThreadRow` `http://localhost:1433/src/components/ThreadRow.tsx?t=1:42:7` [screenshot-1.png]: Too low',
      '2. arrow from (100, 100) to (300, 120) [screenshot-1.png]: Move it here',
      '3. rectangle at (10, 10), 40×20 [screenshot-2.png]: Settings row',
    ])
  })

  test('the dev server writes screenshot.png, feedback.md and feedback.json with repository paths', async () => {
    const base = await mkdtemp(join(tmpdir(), 'zomfy-feedback-test-'))
    try {
      const png = Buffer.from([0x89, 0x50, 0x4e, 0x47])
      const response = await writeFeedbackBundle(
        {
          payload,
          screenshot: `data:image/png;base64,${png.toString('base64')}`,
          viewShots: [1, 2].map((n) => ({ n, image: `data:image/png;base64,${png.toString('base64')}` })),
          crops: [{ n: 1, image: `data:image/png;base64,${png.toString('base64')}` }],
        },
        { baseDir: base, viteRoot: vite, repoRoot: repo, now: new Date('2026-11-27T09:30:12.345Z') },
      )
      expect(response.dir).toBe(join(base, '2026-11-27T09-30-12-345Z'))
      expect(await readFile(join(response.dir, 'screenshot.png'))).toEqual(png)
      const json = JSON.parse(await readFile(join(response.dir, 'feedback.json'), 'utf8'))
      expect(json.pins[0].source.file).toBe('apps/desktop/src/components/ThreadRow.tsx')
      expect(json.pins[0].stack[0].source.file).toBe('apps/desktop/src/components/Sidebar.tsx')
      expect(json.screenshot).toBe('screenshot.png')
      for (const name of ['screenshot-1.png', 'screenshot-2.png', 'element-1.png']) expect(await readFile(join(response.dir, name))).toEqual(png)
      expect(await readFile(join(response.dir, 'feedback.md'), 'utf8')).toContain('`ThreadRow` at `apps/desktop/src/components/ThreadRow.tsx:42:7`')
      expect(response.summary).toContain('Too low')
    } finally {
      await rm(base, { recursive: true, force: true })
    }
  })

  test('a screenshot that is not a PNG data URL is refused', async () => {
    await expect(writeFeedbackBundle({ payload, screenshot: 'nope', viewShots: [], crops: [] }, { baseDir: tmpdir(), viteRoot: vite, repoRoot: repo })).rejects.toThrow('PNG')
  })
})
