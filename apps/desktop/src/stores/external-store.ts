import { useSyncExternalStore } from 'react'

export interface ExternalStore<T> {
  get(): T
  set(next: T): void
  update(change: (current: T) => T): void
  subscribe(listener: () => void): () => void
  /** Re-renders only when the selected value changes (by Object.is). */
  use<S>(select: (state: T) => S): S
}

/** A minimal store for React's useSyncExternalStore, like session-store's but reusable. */
export function createExternalStore<T>(initial: T, onChange?: (state: T) => void): ExternalStore<T> {
  let state = initial
  const listeners = new Set<() => void>()
  const store: ExternalStore<T> = {
    get: () => state,
    set(next) {
      if (Object.is(next, state)) return
      state = next
      onChange?.(state)
      for (const listener of listeners) listener()
    },
    update: (change) => store.set(change(state)),
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    use: (select) => useSyncExternalStore(store.subscribe, () => select(state))
  }
  return store
}
