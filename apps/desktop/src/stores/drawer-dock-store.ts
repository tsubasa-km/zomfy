import { DRAWER_EDGES, type DrawerDock, type DrawerEdge } from '@/components/tab-layout/drawer-docking'
import { createExternalStore } from './external-store'

const STORAGE_KEY = 'zomfy.drawer-dock.v1'
const LEGACY_HEIGHT_KEY = 'zomfy.drawer-height.v1'

interface DrawerPreferences {
  dock: DrawerDock
  depths: Partial<Record<DrawerEdge, number>>
}

function readSaved(key: string): unknown {
  try {
    return JSON.parse(localStorage.getItem(key) ?? 'null')
  } catch {
    return null
  }
}

function readPreferences(): DrawerPreferences {
  const saved = readSaved(STORAGE_KEY) as Partial<DrawerPreferences> | null
  const edge = saved?.dock?.edge
  const position = saved?.dock?.position
  const depths: DrawerPreferences['depths'] = {}
  for (const candidate of DRAWER_EDGES) {
    const depth = saved?.depths?.[candidate]
    if (typeof depth === 'number' && Number.isFinite(depth) && depth > 0) depths[candidate] = depth
  }
  const oldHeight = readSaved(LEGACY_HEIGHT_KEY)
  if (saved === null && typeof oldHeight === 'number' && Number.isFinite(oldHeight)) {
    depths.top = Math.max(192, oldHeight)
  }
  return {
    dock: {
      edge: edge && DRAWER_EDGES.includes(edge) ? edge : 'top',
      position: typeof position === 'number' && Number.isFinite(position) ? Math.max(0, Math.min(1, position)) : 0.5
    },
    depths
  }
}

const store = createExternalStore<DrawerPreferences>(readPreferences(), (value) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(value))
  } catch {
    // Storage can be unavailable; the preferences then last for this session only.
  }
})

export const useDrawerDock = () => store.use((value) => value.dock)
export const useDrawerEdge = () => store.use((value) => value.dock.edge)
export const useDrawerDepth = (edge: DrawerEdge) => store.use((value) => value.depths[edge])

export function setDrawerDock(dock: DrawerDock): void {
  store.update((value) => ({ ...value, dock }))
}

export function setDrawerDepth(edge: DrawerEdge, depth?: number): void {
  store.update((value) => ({ ...value, depths: { ...value.depths, [edge]: depth } }))
}
