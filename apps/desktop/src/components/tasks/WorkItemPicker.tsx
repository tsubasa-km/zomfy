import { useEffect, useState } from 'react'
import { CircleDot, Link2, LoaderCircle } from 'lucide-react'
import { HARNESS_METHODS, type HostedWorkItem } from '@acp-harness/protocol'
import { harnessRequest } from '@/daemon-connection'
import type { HostedProject } from '@/session-store'
import { Button } from '@/components/ui/button'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { HostedReviewIcon } from '@/components/right-sidebar/checks/review-presentation'
import { t } from '@/i18n/i18n'

// Orca's smart workspace source tabs (SmartWorkspaceSourceTabs): search the project's open issues
// and PRs/MRs from the new-workspace composer and link one.

const LIMIT = 10

export function WorkItemPicker({ project, onPick }: { project: HostedProject; onPick: (item: HostedWorkItem) => void }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<{ issues: HostedWorkItem[]; reviews: HostedWorkItem[] } | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    let cancelled = false
    // Debounced: every keystroke would otherwise be two gh/glab searches.
    const timer = window.setTimeout(() => {
      const search = query.trim().replace(/^[#!]/, '')
      const ask = (kind: 'issue' | 'review') =>
        harnessRequest(HARNESS_METHODS.hostingWorkItems, { projectId: project.id, kind, preset: 'open', search, limit: LIMIT }, project.hostId)
      void Promise.all([ask('issue'), ask('review')]).then(
        ([issues, reviews]) => {
          if (cancelled) return
          setMessage(issues.availability.state === 'ready' ? null : (issues.availability.message ?? t('No GitHub or GitLab remote')))
          setResults({ issues: issues.items, reviews: reviews.items })
        },
        (e) => !cancelled && setMessage(e instanceof Error ? e.message : String(e))
      )
    }, 300)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [open, query, project.id, project.hostId])

  const pick = (item: HostedWorkItem) => {
    setOpen(false)
    onPick(item)
  }
  const reviewHeading = results?.reviews[0]?.provider === 'gitlab' ? t('Merge requests') : t('Pull requests')

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" size="xs" variant="ghost" className="h-5 text-muted-foreground" data-link-work-item>
          <Link2 />
          {t('Issue or PR')}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 p-0">
        <Command shouldFilter={false}>
          <CommandInput placeholder={t('Search open issues and PRs, or #1234')} value={query} onValueChange={setQuery} />
          <CommandList>
            {!results && !message && (
              <div className="flex justify-center py-4">
                <LoaderCircle className="size-4 animate-spin text-muted-foreground" />
              </div>
            )}
            {message && <div className="px-3 py-3 text-xs break-words text-muted-foreground">{message}</div>}
            {results && !message && <CommandEmpty>{t('No open issues or PRs match.')}</CommandEmpty>}
            {results && results.issues.length > 0 && (
              <CommandGroup heading={t('Issues')}>
                {results.issues.map((item) => (
                  <CommandItem key={`i${item.number}`} value={`issue-${item.number}`} onSelect={() => pick(item)} data-work-item-option={`issue-${item.number}`}>
                    <CircleDot className="size-3.5 text-emerald-500" />
                    <span className="shrink-0 text-xs text-muted-foreground tabular-nums">#{item.number}</span>
                    <span className="min-w-0 flex-1 truncate">{item.title}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {results && results.reviews.length > 0 && (
              <CommandGroup heading={reviewHeading}>
                {results.reviews.map((item) => (
                  <CommandItem key={`r${item.number}`} value={`review-${item.number}`} onSelect={() => pick(item)} data-work-item-option={`review-${item.number}`}>
                    <HostedReviewIcon review={{ provider: item.provider, state: item.state, checksStatus: item.checksStatus ?? 'none' }} className="size-3.5" />
                    <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                      {item.provider === 'gitlab' ? '!' : '#'}
                      {item.number}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{item.title}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
