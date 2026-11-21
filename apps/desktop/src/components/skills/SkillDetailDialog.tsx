import { useEffect, useState } from 'react'
import { Check, ClipboardCopy, FolderOpen, Plus, Trash2 } from 'lucide-react'
import { HARNESS_METHODS, type DiscoveredSkill, type SkillDiscoveryResult } from '@zomfy/protocol'
import { harnessRequest } from '@/daemon-connection'
import type { HostId } from '@/session-store'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { NativeChatMarkdown } from '@/components/native-chat/NativeChatMarkdown'
import { skillAgentLabel, skillAgents, skillCopyTargets, sourceKindLabel } from './skills-filter'
import { t } from '@/i18n/i18n'

// Orca's SkillDetailDialog.tsx, plus the SKILL.md itself (read on the skill's host) so a skill can
// be checked without leaving the app.

const updatedFormatter = new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric' })

type Markdown = { status: 'loading' } | { status: 'ready'; content: string; truncated: boolean } | { status: 'error'; message: string }

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </>
  )
}

function stripFrontmatter(markdown: string): string {
  return markdown.replace(/^﻿?---\s*\r?\n[\s\S]*?\r?\n---\s*(?:\r?\n|$)/, '')
}

export function SkillDetailDialog({
  skill,
  hostId,
  agentByRootPath,
  result,
  deleteBlockedReason,
  onOpenChange,
  onReveal,
  onDelete,
  onCopied
}: {
  skill: DiscoveredSkill | null
  hostId: HostId
  agentByRootPath: ReadonlyMap<string, string>
  /** The scan the skill came from: where else it can go. */
  result: SkillDiscoveryResult | null
  deleteBlockedReason: string | null
  onOpenChange: (open: boolean) => void
  onReveal: () => void
  onDelete: () => void
  /** A copy landed: the list scans again. */
  onCopied: () => void
}) {
  const [markdown, setMarkdown] = useState<Markdown>({ status: 'loading' })
  const [view, setView] = useState<'preview' | 'source'>('preview')
  const path = skill?.skillFilePath ?? null

  useEffect(() => {
    if (!path) return
    let current = true
    setMarkdown({ status: 'loading' })
    harnessRequest(HARNESS_METHODS.skillRead, { skillFilePath: path }, hostId).then(
      (r) => current && setMarkdown({ status: 'ready', ...r }),
      (e: unknown) => current && setMarkdown({ status: 'error', message: e instanceof Error ? e.message : String(e) })
    )
    return () => {
      current = false
    }
  }, [path, hostId])

  if (!skill) return null
  const agents = skillAgents(skill, agentByRootPath).map(skillAgentLabel).sort((a, b) => a.localeCompare(b))

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl gap-0 overflow-hidden p-0" data-skill-detail>
        <DialogHeader className="space-y-1 border-b border-border py-4 pr-10 pl-5">
          <DialogTitle className="min-w-0 text-base break-words">{skill.name}</DialogTitle>
          <DialogDescription className="text-xs">
            {sourceKindLabel(skill.sourceKind)}
            {' · '}
            {skill.sourceLabel}
          </DialogDescription>
        </DialogHeader>

        <div className="scrollbar-sleek max-h-[65vh] space-y-4 overflow-y-auto px-5 py-4">
          <p className="text-sm leading-6 whitespace-pre-wrap">{skill.description ?? t('No description found.')}</p>
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 border-t border-border pt-4 text-xs">
            {agents.length > 0 ? <DetailRow label={t('Agents')}>{agents.join(', ')}</DetailRow> : null}
            <DetailRow label={t('Updated')}>{skill.updatedAt ? updatedFormatter.format(new Date(skill.updatedAt)) : t('No date')}</DetailRow>
            <DetailRow label={t('Path')}>
              <span className="flex min-w-0 items-start gap-2">
                <span className="min-w-0 flex-1 font-mono break-all">{skill.skillFilePath}</span>
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  className="-my-1 shrink-0 text-muted-foreground"
                  onClick={() => void navigator.clipboard.writeText(skill.skillFilePath)}
                >
                  <ClipboardCopy />
                  {t('Copy')}
                </Button>
              </span>
            </DetailRow>
          </dl>
          {skill.sourceKind === 'home' || skill.sourceKind === 'repo' ? (
            <SkillCopySection skill={skill} hostId={hostId} result={result} onCopied={onCopied} />
          ) : null}
          <section className="space-y-2 border-t border-border pt-4">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-xs font-medium text-muted-foreground">SKILL.md</h3>
              <ToggleGroup
                type="single"
                variant="outline"
                size="sm"
                spacing={1}
                value={view}
                onValueChange={(value) => value && setView(value === 'source' ? 'source' : 'preview')}
                aria-label={t('SKILL.md view')}
              >
                <ToggleGroupItem value="preview" className="rounded-full px-2.5 text-xs">
                  {t('Preview')}
                </ToggleGroupItem>
                <ToggleGroupItem value="source" className="rounded-full px-2.5 text-xs">
                  {t('Source')}
                </ToggleGroupItem>
              </ToggleGroup>
            </div>
            {markdown.status === 'loading' ? (
              <p className="text-xs text-muted-foreground">{t('Loading…')}</p>
            ) : markdown.status === 'error' ? (
              <p className="text-xs text-destructive">{markdown.message}</p>
            ) : (
              <div className="rounded-md border border-border/60 bg-muted/20 px-4 py-3" data-skill-markdown>
                {view === 'source' ? (
                  <pre className="font-mono text-xs leading-5 whitespace-pre-wrap">{markdown.content}</pre>
                ) : (
                  <NativeChatMarkdown content={stripFrontmatter(markdown.content)} className="text-sm" />
                )}
                {markdown.truncated ? <p className="mt-2 text-[11px] text-muted-foreground">{t('Showing the first 256 KB.')}</p> : null}
              </div>
            )}
          </section>
        </div>

        <DialogFooter className="border-t border-border px-5 py-3">
          <Button type="button" variant="ghost" size="sm" onClick={onReveal}>
            <FolderOpen className="size-3.5" />
            {t('Reveal file')}
          </Button>
          <span className="mr-auto inline-flex" title={deleteBlockedReason ?? undefined}>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-destructive hover:text-destructive"
              disabled={deleteBlockedReason !== null}
              onClick={onDelete}
            >
              <Trash2 className="size-3.5" />
              {t('Delete…')}
            </Button>
          </span>
          <Button type="button" size="sm" onClick={() => onOpenChange(false)}>
            {t('Done')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Orca's install picker, for a skill already on the host: one click puts it in another agent's folder. */
function SkillCopySection({
  skill,
  hostId,
  result,
  onCopied
}: {
  skill: DiscoveredSkill
  hostId: HostId
  result: SkillDiscoveryResult | null
  onCopied: () => void
}) {
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const targets = skillCopyTargets(skill, result)
  if (targets.length === 0) return null
  const copy = (sourceId: string) => {
    setBusy(sourceId)
    setError(null)
    harnessRequest(HARNESS_METHODS.skillCopy, { skillFilePath: skill.skillFilePath, sourceIds: [sourceId] }, hostId)
      .then(({ outcomes }) => {
        const failed = outcomes.find((o) => o.status === 'failed')
        if (failed) setError(failed.error ?? t('Could not add the skill'))
        else onCopied()
      }, (e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(null))
  }
  return (
    <section className="space-y-2 border-t border-border pt-4" data-skill-copy>
      <div>
        <h3 className="text-xs font-medium text-muted-foreground">{t('Use with other agents')}</h3>
        <p className="mt-0.5 text-[11px] text-muted-foreground">{t("Copies this skill into the agent's skill folder, where that agent finds it.")}</p>
      </div>
      <ul className="divide-y divide-border/50 rounded-md border border-border/60">
        {targets.map((target) => (
          <li key={target.sourceId} className="flex items-center gap-2 px-3 py-1.5 text-xs" data-skill-copy-target={target.sourceId}>
            <span className="font-medium">{target.agent}</span>
            <span className="min-w-0 flex-1 truncate text-muted-foreground">{target.scope}</span>
            {target.has ? (
              <span className="inline-flex items-center gap-1 text-muted-foreground">
                <Check className="size-3.5" />
                {t('Added')}
              </span>
            ) : (
              <Button type="button" variant="outline" size="xs" disabled={busy !== null} onClick={() => copy(target.sourceId)}>
                <Plus className="size-3" />
                {busy === target.sourceId ? t('Adding…') : t('Add')}
              </Button>
            )}
          </li>
        ))}
      </ul>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </section>
  )
}
