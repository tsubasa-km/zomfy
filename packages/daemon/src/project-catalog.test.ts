import { describe, expect, test } from 'bun:test'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { cleanCatalog, detachLocation, fromLinks, placeLocation, ProjectCatalogStore, renameProject, syncHost } from './project-catalog.ts'

const wsl = (projectId: string) => ({ hostId: 'wsl:Ubuntu', projectId })
const local = (projectId: string) => ({ hostId: 'local', projectId })

describe('project catalog', () => {
  test('a host project the catalog lacks joins alone, under its location key', () => {
    expect(syncHost([], 'local', ['a', 'b'])).toEqual([
      { id: 'local:a', locations: [local('a')] },
      { id: 'local:b', locations: [local('b')] }
    ])
  })

  test('a gone project leaves its entry, and an entry left empty goes', () => {
    const catalog = [
      { id: 'x', locations: [local('a'), wsl('w')] },
      { id: 'local:b', locations: [local('b')] }
    ]
    expect(syncHost(catalog, 'local', [])).toEqual([{ id: 'x', locations: [wsl('w')] }])
  })

  test('a sync leaves other hosts alone', () => {
    const catalog = [{ id: 'x', locations: [local('a'), wsl('w')] }]
    expect(syncHost(catalog, 'wsl:Ubuntu', ['w'])).toEqual(catalog)
  })

  test('placing moves a location between entries', () => {
    const catalog = syncHost(syncHost([], 'local', ['a']), 'wsl:Ubuntu', ['w'])
    expect(placeLocation(catalog, 'local:a', wsl('w'))).toEqual([{ id: 'local:a', locations: [local('a'), wsl('w')] }])
    expect(() => placeLocation(catalog, 'nope', wsl('w'))).toThrow()
  })

  test('detaching gives a location its own entry, with a fresh id when its key is taken', () => {
    const catalog = [{ id: 'local:a', locations: [local('a'), wsl('w')] }]
    expect(detachLocation(catalog, wsl('w'))).toEqual([
      { id: 'local:a', locations: [local('a')] },
      { id: 'wsl:Ubuntu:w', locations: [wsl('w')] }
    ])
    const [rest, alone] = detachLocation(catalog, local('a'))
    expect(rest).toEqual({ id: 'local:a', locations: [wsl('w')] })
    expect(alone!.id).not.toBe('local:a')
    expect(alone!.locations).toEqual([local('a')])
    expect(detachLocation([{ id: 'local:a', locations: [local('a')] }], local('a'))).toEqual([{ id: 'local:a', locations: [local('a')] }])
  })

  test('a name is set, kept through syncs, and taken away by an empty one', () => {
    const named = renameProject([{ id: 'x', locations: [local('a'), wsl('w')] }], 'x', '  Zomfy ')
    expect(named).toEqual([{ id: 'x', locations: [local('a'), wsl('w')], name: 'Zomfy' }])
    expect(syncHost(named, 'local', ['a'])[0]!.name).toBe('Zomfy')
    expect(renameProject(named, 'x', '')).toEqual([{ id: 'x', locations: [local('a'), wsl('w')] }])
    expect(renameProject(named, 'x', null)).toEqual([{ id: 'x', locations: [local('a'), wsl('w')] }])
    expect(() => renameProject(named, 'nope', 'Zomfy')).toThrow()
  })

  test('a catalog file is cleaned of what does not fit', () => {
    expect(
      cleanCatalog([
        { id: 'x', locations: [local('a'), { hostId: 1 }], name: 'Zomfy' },
        { id: 'y', locations: [local('a'), wsl('w')], name: 3 },
        { id: 'x', locations: [wsl('v')] },
        { locations: [wsl('u')] },
        { id: 'z' },
        null
      ])
    ).toEqual([
      { id: 'x', locations: [local('a')], name: 'Zomfy' },
      { id: 'y', locations: [wsl('w')] }
    ])
    expect(() => cleanCatalog({})).toThrow()
  })

  test('links become entries, a host project in one only', () => {
    const links = [
      { id: 'l1', members: [local('a'), wsl('w')] },
      { id: 'l2', members: [wsl('w'), local('b')] },
      { id: 3, members: [] }
    ]
    expect(fromLinks(links)).toEqual([
      { id: 'l1', locations: [local('a'), wsl('w')] },
      { id: 'l2', locations: [local('b')] }
    ])
  })

  test('the store starts from project-links.json and writes its own file', async () => {
    const home = await mkdtemp(join(tmpdir(), 'catalog-'))
    try {
      await writeFile(join(home, 'project-links.json'), JSON.stringify([{ id: 'l1', members: [local('a'), wsl('w')] }]))
      const store = new ProjectCatalogStore(home)
      const [first, second] = await Promise.all([store.sync('local', ['a', 'b']), store.sync('wsl:Ubuntu', ['w', 'v'])])
      expect(first.changed).toBe(true)
      expect(second.catalog).toEqual([
        { id: 'l1', locations: [local('a'), wsl('w')] },
        { id: 'local:b', locations: [local('b')] },
        { id: 'wsl:Ubuntu:v', locations: [wsl('v')] }
      ])
      expect(JSON.parse(await readFile(join(home, 'project-catalog.json'), 'utf8'))).toEqual(second.catalog)
      expect((await store.sync('local', ['a', 'b'])).changed).toBe(false)
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  })

  test('the links are read once: a catalog file written from them stays the source', async () => {
    const home = await mkdtemp(join(tmpdir(), 'catalog-'))
    try {
      await writeFile(join(home, 'project-links.json'), JSON.stringify([{ id: 'l1', members: [local('a'), wsl('w')] }]))
      expect(await new ProjectCatalogStore(home).list()).toEqual([{ id: 'l1', locations: [local('a'), wsl('w')] }])
      expect(JSON.parse(await readFile(join(home, 'project-catalog.json'), 'utf8'))).toEqual([{ id: 'l1', locations: [local('a'), wsl('w')] }])
      const store = new ProjectCatalogStore(home)
      await store.detach(wsl('w'))
      expect((await new ProjectCatalogStore(home).list()).length).toBe(2)
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  })

  test('an unreadable catalog file is kept aside, and the links are not read again', async () => {
    const home = await mkdtemp(join(tmpdir(), 'catalog-'))
    try {
      await writeFile(join(home, 'project-links.json'), JSON.stringify([{ id: 'l1', members: [local('a'), wsl('w')] }]))
      await writeFile(join(home, 'project-catalog.json'), '{ not json')
      expect(await new ProjectCatalogStore(home).list()).toEqual([])
      const files = await readdir(home)
      expect(files.some((f) => f.startsWith('project-catalog.json.unreadable-'))).toBe(true)
      expect(JSON.parse(await readFile(join(home, 'project-catalog.json'), 'utf8'))).toEqual([])
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  })
})
