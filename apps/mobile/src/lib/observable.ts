// A value with listeners, shaped for React's useSyncExternalStore (subscribe + getSnapshot).

export class Observable<T> {
  private readonly listeners = new Set<() => void>()

  constructor(private value: T) {}

  get = (): T => this.value

  set(next: T): void {
    if (Object.is(next, this.value)) return
    this.value = next
    for (const listener of [...this.listeners]) listener()
  }

  update(change: (current: T) => T): void {
    this.set(change(this.value))
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
}
