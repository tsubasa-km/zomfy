import type { DrawerOpenAction } from '@/stores/settings-store'

export interface DrawerKept {
  /** The tab's hover-mode pin. Click mode shows no pin but leaves this as it was. */
  pinned: boolean
  activeId: string | null
}

/** What each tab's drawer was left showing, so coming back to a tab finds its drawer as it was. */
export class DrawerMemory {
  private readonly kept = new Map<string, DrawerKept>()

  recall(tabId: string | undefined): DrawerKept | undefined {
    return tabId ? this.kept.get(tabId) : undefined
  }

  remember(tabId: string | undefined, kept: DrawerKept): void {
    if (tabId) this.kept.set(tabId, kept)
  }
}

/** Whether the open action changing from `previous` to `next` unpins a drawer: only the active one, on entering click mode. */
export function modeChangeUnpins(previous: DrawerOpenAction, next: DrawerOpenAction, active: boolean): boolean {
  return active && previous !== 'click' && next === 'click'
}
