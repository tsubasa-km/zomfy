import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { invoke, isTauri } from '@tauri-apps/api/core'
import { BookOpen, ChevronDown, RefreshCw, Search, X } from 'lucide-react'
import { HARNESS_METHODS, type DiscoveredSkill, type SkillDiscoveryResult } from '@acp-harness/protocol'
import { harnessRequest } from '@/daemon-connection'
import { LOCAL_HOST, allWorkspaces, useStore, type HostId } from '@/session-store'
import { setSkillsPageOpen } from '@/stores/app-overlay-store'
import { useCommandHandler } from '@/keybindings/keybinding-registry'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { SkillRow, skillRowActions } from './SkillRow'
import { SkillDetailDialog } from './SkillDetailDialog'
import {
  NO_SKILL_FILTERS,
  SKILL_SOURCE_KINDS,
  countLabel,
  countSkillsBySource,
  filterSkills,
  skillAgentByRootPath,
  skillAgentOptions,
  skillDeleteBlockReason,
  sourceKindLabel,
  type SkillsFilterState
} from './skills-filter'
import { t } from '@/i18n/i18n'

// Orca's Skills page (components/skills/SkillsPage.tsx and its header, filter toolbar and states).
// The scan runs on one daemon host at a time — the active workspace's by default — so WSL and SSH
// hosts list their own skills. Orca's cloud sharing and install-from-link are not ported.

/** Every band aligns to this column so header, filters and rows share one left edge. */
const COLUMN = 'w-full px-5 md:px-8'

type ScanState = { hostId: HostId; result: SkillDiscoveryResult | null; error: string | null }

function useDefaultSkillsHost(): HostId {
  return useStore((s) => {
    const active = allWorkspaces(s).find((w) => w.id === s.activeWorkspaceId)?.hostId
    return active && s.hosts[active]?.connection.kind === 'connected' ? active : LOCAL_HOST
  })
}

function revealSkill(hostId: HostId, skill: DiscoveredSkill): void {
  if (!isTauri()) return
  // An SSH host's folders can't open in the file manager; VS Code Remote can.
  const target = hostId.startsWith('ssh:') ? 'vscode' : 'explorer'
  void invoke('open_workspace_in', { target, host: hostId, path: skill.directoryPath }).catch((e: unknown) => window.alert(String(e)))
}

export function SkillsPage() {
  const defaultHost = useDefaultSkillsHost()
  const [pickedHost, setPickedHost] = useState<HostId | null>(null)
  const hosts = useStore((s) => s.hosts)
  const connectedHosts = Object.values(hosts).filter((h) => h.connection.kind === 'connected')
  const hostId = pickedHost && hosts[pickedHost]?.connection.kind === 'connected' ? pickedHost : defaultHost
  const hostLabel = hosts[hostId]?.label ?? hostId

  const [scan, setScan] = useState<ScanState | null>(null)
  const [loading, setLoading] = useState(true)
  const [filters, setFilters] = useState<SkillsFilterState>(NO_SKILL_FILTERS)
  const [detail, setDetail] = useState<DiscoveredSkill | null>(null)
  const [deleting, setDeleting] = useState<DiscoveredSkill | null>(null)
  const generation = useRef(0)

  const current = scan?.hostId === hostId ? scan : null
  const result = current?.result ?? null

  const load = useCallback(async () => {
    // A scan for a host the user already switched away from must not land.
    const mine = ++generation.current
    setLoading(true)
    try {
      const next = await harnessRequest(HARNESS_METHODS.skillsDiscover, {}, hostId)
      if (mine === generation.current) setScan({ hostId, result: next, error: null })
    } catch (error) {
      if (mine === generation.current) {
        const message = error instanceof Error ? error.message : String(error)
        setScan((s) => ({ hostId, result: s?.hostId === hostId ? s.result : null, error: message }))
      }
    } finally {
      if (mine === generation.current) setLoading(false)
    }
  }, [hostId])

  useEffect(() => {
    void load()
  }, [load])

  const close = useCallback(() => setSkillsPageOpen(false), [])
  // Esc closes the page unless a dialog is up; dialogs take Escape themselves.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented && !detail && !deleting) close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [close, detail, deleting])
  useCommandHandler('skills.open', close)

  const skills = result?.skills ?? []
  const agentByRootPath = useMemo(() => skillAgentByRootPath(result), [result])
  const agentOptions = useMemo(() => skillAgentOptions(result), [result])
  const visible = useMemo(() => filterSkills(skills, filters, agentByRootPath), [skills, filters, agentByRootPath])
  const sourceCounts = useMemo(() => countSkillsBySource(skills), [skills])
  const filtered = filters.query.trim() !== '' || filters.sourceKind !== 'all' || filters.agent !== 'all'

  const actionsFor = (skill: DiscoveredSkill) =>
    skillRowActions({
      skill,
      deleteBlockedReason: skillDeleteBlockReason(skill),
      onOpenDetail: () => setDetail(skill),
      onReveal: () => revealSkill(hostId, skill),
      onDelete: () => setDeleting(skill)
    })

  return (
    <main className="flex min-h-0 flex-1 flex-col bg-background" data-skills-page>
      <header className="shrink-0 border-b border-border">
        <div className={cn(COLUMN, 'flex items-center gap-2 py-3')}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="size-7 shrink-0 rounded-full" onClick={close} aria-label={t('Close skills')}>
                <X className="size-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom" sideOffset={6}>
              {t('Close · Esc')}
            </TooltipContent>
          </Tooltip>
          <div className="mx-1 h-5 w-px bg-border/50" aria-hidden />
          <BookOpen className="size-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-sm font-semibold">{t('Skills')}</h1>
            <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
              <span className="shrink-0">{countLabel(skills.length, '{n} skill', '{n} skills')}</span>
              {result && result.sources.length > 0 ? (
                <>
                  <span aria-hidden>·</span>
                  <SourcesPopover result={result} />
                </>
              ) : null}
              <span aria-hidden>·</span>
              <span className="truncate">{hostLabel}</span>
            </div>
          </div>
          {connectedHosts.length > 1 ? (
            <Select value={hostId} onValueChange={setPickedHost}>
              <SelectTrigger className="h-8 w-[180px]" aria-label={t('Host')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {connectedHosts.map((h) => (
                  <SelectItem key={h.id} value={h.id}>
                    {h.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
        </div>
      </header>

      <section className="shrink-0 border-b border-border">
        <div className={cn(COLUMN, 'flex flex-col gap-2 py-3')}>
          <div className="flex items-center gap-2">
            <div className="relative min-w-0 flex-1">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={filters.query}
                onChange={(event) => setFilters({ ...filters, query: event.target.value })}
                placeholder={t('Search skills')}
                aria-label={t('Search skills')}
                className="h-8 pl-8 text-sm"
                data-skills-search
              />
            </div>
            <Select value={filters.agent} onValueChange={(agent) => setFilters({ ...filters, agent })}>
              <SelectTrigger className="h-8 w-[170px]" aria-label={t('Filter by agent')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('All agents')}</SelectItem>
                {agentOptions.map((option) => (
                  <SelectItem key={option.id} value={option.id}>
                    {option.label} <span className="text-muted-foreground">{option.count}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="shrink-0 border border-border/50 bg-transparent hover:bg-muted/50"
                  disabled={loading}
                  onClick={() => void load()}
                  aria-label={t('Refresh')}
                >
                  <RefreshCw className={loading ? 'animate-spin' : undefined} />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom" sideOffset={6}>
                {t('Refresh')}
              </TooltipContent>
            </Tooltip>
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <ToggleGroup
              type="single"
              variant="outline"
              size="sm"
              spacing={1}
              value={filters.sourceKind}
              // Radix reports '' when the active item is pressed again; fall back to all.
              onValueChange={(value) =>
                setFilters({ ...filters, sourceKind: SKILL_SOURCE_KINDS.find((k) => k === value) ?? 'all' })
              }
              aria-label={t('Filter by source')}
            >
              <ToggleGroupItem value="all" className="gap-1.5 rounded-full px-2.5 text-xs">
                {t('All')}
                <span className="text-muted-foreground tabular-nums">{skills.length}</span>
              </ToggleGroupItem>
              {SKILL_SOURCE_KINDS.map((kind) => (
                <ToggleGroupItem key={kind} value={kind} className="gap-1.5 rounded-full px-2.5 text-xs">
                  {sourceKindLabel(kind)}
                  <span className="text-muted-foreground tabular-nums">{sourceCounts[kind]}</span>
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
              <span role="status" aria-live="polite">
                {countLabel(visible.length, '{n} result', '{n} results')}
              </span>
              {filtered ? (
                <Button type="button" variant="ghost" size="xs" onClick={() => setFilters(NO_SKILL_FILTERS)}>
                  {t('Clear filters')}
                </Button>
              ) : null}
            </div>
          </div>
        </div>
      </section>

      {current?.error ? (
        <div className="border-b border-destructive/30 bg-destructive/10">
          <div className={cn(COLUMN, 'flex flex-wrap items-center justify-between gap-3 py-2')}>
            <div className="min-w-0 flex-1" role="alert">
              <p className="text-xs font-medium text-destructive">{t('Could not scan skills')}</p>
              <p className="text-xs leading-snug break-words whitespace-pre-line text-destructive">{current.error}</p>
            </div>
            <Button type="button" variant="outline" size="xs" disabled={loading} onClick={() => void load()}>
              {t('Retry')}
            </Button>
          </div>
        </div>
      ) : null}

      <section className="scrollbar-sleek min-h-0 flex-1 overflow-y-auto">
        <div className={cn(COLUMN, 'py-2')} role="listbox" aria-label={t('Skills')} data-skills-list>
          {loading && skills.length === 0 ? (
            <SkillsListSkeleton />
          ) : visible.length > 0 ? (
            visible.map((skill) => <SkillRow key={skill.id} skill={skill} actions={actionsFor(skill)} onOpenDetail={() => setDetail(skill)} />)
          ) : skills.length > 0 ? (
            <div className="flex flex-col items-center gap-2 px-2 py-12 text-center">
              <p className="text-sm font-semibold">{t('No matches')}</p>
              <p className="max-w-sm text-xs leading-5 text-muted-foreground">{t('No skill matches the current search and filters.')}</p>
              <Button variant="outline" size="sm" className="mt-1" onClick={() => setFilters(NO_SKILL_FILTERS)}>
                {t('Clear filters')}
              </Button>
            </div>
          ) : result ? (
            <div className="flex flex-col items-center gap-3 px-2 py-12 text-center">
              <BookOpen className="size-7 text-muted-foreground" />
              <div className="space-y-1">
                <h2 className="text-sm font-semibold">{t('No skills found')}</h2>
                <p className="max-w-sm text-xs leading-5 text-muted-foreground">
                  {t('The scanned skill folders on {host} are empty. Refresh after adding a skill.', { host: hostLabel })}
                </p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => void load()}>
                <RefreshCw className="size-4" />
                {t('Refresh')}
              </Button>
            </div>
          ) : null}
        </div>
      </section>

      <SkillDetailDialog
        skill={detail}
        hostId={hostId}
        agentByRootPath={agentByRootPath}
        deleteBlockedReason={detail ? skillDeleteBlockReason(detail) : null}
        onOpenChange={(open) => !open && setDetail(null)}
        onReveal={() => detail && revealSkill(hostId, detail)}
        onDelete={() => detail && setDeleting(detail)}
      />
      <DeleteSkillDialog
        skill={deleting}
        hostId={hostId}
        hostLabel={hostLabel}
        onClose={(deleted) => {
          setDeleting(null)
          if (deleted) {
            setDetail(null)
            void load()
          }
        }}
      />
    </main>
  )
}

const SKELETON_ROWS = [0, 1, 2, 3, 4, 5, 6, 7]

function SkillsListSkeleton() {
  return (
    <div>
      <p className="px-2 py-2 text-xs text-muted-foreground" role="status" aria-live="polite">
        {t('Scanning skills')}
      </p>
      {SKELETON_ROWS.map((row) => (
        <div key={row} className="flex items-start gap-3 border-b border-border/50 px-2 py-2.5">
          <div className="min-w-0 flex-1 space-y-2">
            <div className="h-3.5 w-48 animate-pulse rounded bg-muted/70" />
            <div className="h-3 w-full max-w-lg animate-pulse rounded bg-muted/50" />
          </div>
        </div>
      ))}
    </div>
  )
}

/** Orca's SkillsSourcesPopover: every folder the scan looked at, with its skill count. */
function SourcesPopover({ result }: { result: SkillDiscoveryResult }) {
  const scanned = result.sources.filter((s) => s.exists)
  const counts = new Map<string, number>()
  for (const skill of result.skills) {
    for (const root of new Set(skill.rootPaths?.length ? skill.rootPaths : [skill.rootPath])) counts.set(root, (counts.get(root) ?? 0) + 1)
  }
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="link" className="h-auto gap-0.5 p-0 text-xs font-normal has-[>svg]:px-0 text-muted-foreground hover:text-foreground">
          {countLabel(scanned.length, '{n} source', '{n} sources')}
          <ChevronDown className="size-3" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-96 p-0">
        <p className="border-b border-border px-3 py-2 text-[11px] font-semibold tracking-[0.05em] text-muted-foreground uppercase">
          {t('Skill folders')}
        </p>
        <div className="scrollbar-sleek max-h-80 overflow-y-auto py-1">
          {result.sources.map((source) => (
            <div key={source.id} className="px-3 py-2">
              <div className="flex items-baseline gap-2">
                <span className="min-w-0 flex-1 truncate text-xs font-medium">{source.label}</span>
                <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
                  {source.exists ? (counts.get(source.path) ?? 0) : t('Folder not found')}
                </span>
              </div>
              <p className="truncate font-mono text-[11px] text-muted-foreground" title={source.path}>
                {source.path}
              </p>
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}

function DeleteSkillDialog({
  skill,
  hostId,
  hostLabel,
  onClose
}: {
  skill: DiscoveredSkill | null
  hostId: HostId
  hostLabel: string
  onClose: (deleted: boolean) => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    setError(null)
    setBusy(false)
  }, [skill])
  if (!skill) return null
  const confirm = async () => {
    setBusy(true)
    try {
      await harnessRequest(HARNESS_METHODS.skillTrash, { skillFilePath: skill.skillFilePath }, hostId)
      onClose(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setBusy(false)
    }
  }
  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose(false)}>
      <DialogContent className="max-w-md" data-skill-delete>
        <DialogHeader>
          <DialogTitle>{t('Delete {name}?', { name: skill.name })}</DialogTitle>
          <DialogDescription>
            {t('Moves the skill folder on {host} to the trash, so every agent that reads it stops seeing the skill.', { host: hostLabel })}
          </DialogDescription>
        </DialogHeader>
        <p className="font-mono text-xs break-all text-muted-foreground">{skill.directoryPath}</p>
        {error ? <p className="text-xs text-destructive">{error}</p> : null}
        <DialogFooter>
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => onClose(false)}>
            {t('Cancel')}
          </Button>
          <Button variant="destructive" size="sm" disabled={busy} onClick={() => void confirm()}>
            {t('Delete skill')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
