import { useEffect } from 'react'
import { HARNESS_METHODS } from '@zomfy/protocol'
import { harnessRequest } from '@/daemon-connection'
import { LOCAL_HOST } from '@/session-store'
import { createExternalStore } from './external-store'

// Site icons by domain, as data: URLs the local daemon fetched and cached. Asked once per domain
// for the app's run, so re-renders and re-reads of a list never ask again; always the local
// daemon's, so a remote host never fetches for this desktop.

/** undefined while not known yet; null when the domain has no icon. */
const store = createExternalStore<Record<string, string | null>>({})
const asked = new Set<string>()

function ask(domain: string): void {
  if (asked.has(domain)) return
  asked.add(domain)
  harnessRequest(HARNESS_METHODS.favicon, { domain }, LOCAL_HOST)
    .then((result) => store.update((all) => ({ ...all, [domain]: result.dataUrl })))
    .catch(() => store.update((all) => ({ ...all, [domain]: null })))
}

export function useFavicon(domain: string | null): string | null | undefined {
  const icon = store.use((all) => (domain ? all[domain] : null))
  useEffect(() => {
    if (domain) ask(domain)
  }, [domain])
  return icon
}
