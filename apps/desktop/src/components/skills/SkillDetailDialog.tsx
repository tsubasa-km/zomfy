import { useEffect, useState } from 'react'
import { ClipboardCopy, FolderOpen, Trash2 } from 'lucide-react'
import { HARNESS_METHODS, type DiscoveredSkill } from '@acp-harness/protocol'
import { harnessRequest } from '@/daemon-connection'
import type { HostId } from '@/session-store'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { NativeChatMarkdown } from '@/components/native-chat/NativeChatMarkdown'
import { skillAgentLabel, skillAgents, sourceKindLabel } from './skills-filter'
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
  deleteBlockedReason,
  onOpenChange,
  onReveal,
  onDelete
}: {
  skill: DiscoveredSkill | null
  hostId: HostId
  agentByRootPath: ReadonlyMap<string, string>
  deleteBlockedReason: string | null
  onOpenChange: (open: boolean) => void
  onReveal: () => void
  onDelete: () => void
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
