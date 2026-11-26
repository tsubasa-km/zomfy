import { describe, expect, mock, test } from 'bun:test'
import type { HarnessState, SessionInfo } from '@zomfy/protocol'

// The snapshot a window starts from: written by the main window, read back on the next start.
const storage = new Map<string, string>()
Object.assign(globalThis, {
  localStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => void storage.set(key, value) }
})
mock.module('@/lib/window-role', () => ({ WINDOW_ROLE: 'main', WINDOW_WORKSPACE_ID: null }))

const harness = { host: { id: 'local', label: 'This computer' }, projects: [], workspaces: [] } as unknown as HarnessState
const chat = { id: 'c1', title: 'Fix the build', status: 'idle', createdAt: 1, turnStartedAt: null, workspaceId: 'w1' } as unknown as SessionInfo

describe('host snapshots', () => {
  test('keep a host listing and its chats for the next start', async () => {
    const snapshots = await import('../src/lib/host-snapshots.ts')
    snapshots.saveHostSnapshot('local', harness)
    snapshots.saveSessionsSnapshot('local', [chat])
    expect(snapshots.hostSnapshot('local')).toEqual(harness)
    expect(snapshots.sessionsSnapshot('local')).toEqual([chat])
    expect(JSON.parse(storage.get('zomfy.host-snapshots.v1')!)).toEqual({ local: harness })
    // Chats are written a second later, once for a burst of changes.
    expect(storage.has('zomfy.session-snapshots.v1')).toBe(false)
    await Bun.sleep(1100)
    expect(JSON.parse(storage.get('zomfy.session-snapshots.v1')!)).toEqual({ local: [chat] })
  })

  test('forget a removed host entirely', async () => {
    const snapshots = await import('../src/lib/host-snapshots.ts')
    snapshots.saveHostSnapshot('ssh:box', harness)
    snapshots.saveSessionsSnapshot('ssh:box', [chat])
    snapshots.forgetHostSnapshot('ssh:box')
    expect(snapshots.hostSnapshot('ssh:box')).toBeNull()
    expect(snapshots.sessionsSnapshot('ssh:box')).toEqual([])
    expect(JSON.parse(storage.get('zomfy.session-snapshots.v1')!)['ssh:box']).toBeUndefined()
  })
})
