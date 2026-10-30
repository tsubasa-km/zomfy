import { useEffect, useId, useState } from 'react'
import { HARNESS_METHODS, type CreateReviewDefaults, type HostingProviderId } from '@acp-harness/protocol'
import { harnessRequest } from '@/daemon-connection'
import { BranchCombobox } from '@/components/sidebar/BranchCombobox'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { loadChecks, setReviewAfterCreate } from '@/stores/hosting-store'
import { cn } from '@/lib/utils'
import { reviewShortLabel } from './review-presentation'
import { t } from '@/i18n/i18n'

// Orca's CreateHostedReviewComposer(+Fields): title, description, base and draft, inline in the
// Checks panel; "Push & Create" publishes the branch first.

const FIELD = 'h-8 text-[12px]'
const TEXTAREA =
  'w-full min-w-0 rounded-md border border-input bg-transparent px-2 py-1.5 text-[12px] shadow-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50 dark:bg-input/30'

export function CreateReviewComposer({
  workspaceId,
  provider,
  branch,
  needsPush,
  blockedReason
}: {
  workspaceId: string
  provider: HostingProviderId
  branch: string
  /** No upstream yet, or local commits the remote lacks. */
  needsPush: boolean
  /** Why creating is not possible from this branch as it stands. */
  blockedReason?: string | null
}) {
  const label = reviewShortLabel(provider)
  const draftId = useId()
  const [defaults, setDefaults] = useState<CreateReviewDefaults | null>(null)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [base, setBase] = useState('')
  const [draft, setDraft] = useState(false)
  const [busy, setBusy] = useState<'push' | 'create' | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void harnessRequest(HARNESS_METHODS.hostingCreateDefaults, { workspaceId }).then(
      (d) => {
        if (cancelled) return
        setDefaults(d)
        setTitle(d.title)
        setBody(d.body)
        setBase(d.base)
      },
      (e) => !cancelled && setError(e instanceof Error ? e.message : String(e))
    )
    return () => {
      cancelled = true
    }
  }, [workspaceId, branch])

  async function create() {
    setError(null)
    try {
      if (needsPush) {
        setBusy('push')
        await harnessRequest(HARNESS_METHODS.gitPush, { workspaceId })
      }
      setBusy('create')
      const { review } = await harnessRequest(HARNESS_METHODS.hostingCreateReview, { workspaceId, title, body, base, draft })
      setReviewAfterCreate(workspaceId, review)
      if (review) void loadChecks(workspaceId, true)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  const locked = busy !== null || defaults === null
  const sameAsBranch = base === branch
  return (
    <div className="space-y-2.5" data-create-review>
      <Input aria-label={t('{kind} title', { kind: label })} value={title} disabled={locked} onChange={(e) => setTitle(e.target.value)} placeholder={t('Title')} className={cn(FIELD, 'font-medium')} />
      <textarea
        aria-label={t('{kind} description', { kind: label })}
        rows={6}
        value={body}
        disabled={locked}
        onChange={(e) => setBody(e.target.value)}
        placeholder={t('Description (optional)')}
        className={cn(TEXTAREA, 'min-h-[7rem] resize-y')}
      />
      <div className="space-y-1">
        <span className="text-[11px] text-muted-foreground">{t('Base branch')}</span>
        <BranchCombobox
          value={base}
          placeholder={t('Pick a base branch')}
          onChange={setBase}
          groups={[{ heading: t('Remote branches'), options: (defaults?.bases ?? []).map((value) => ({ value })) }]}
        />
        {sameAsBranch && <p className="text-[11px] text-destructive">{t('The base must differ from {branch}.', { branch })}</p>}
      </div>
      <div className="flex items-center gap-2">
        <Checkbox id={draftId} checked={draft} disabled={locked} onCheckedChange={(v) => setDraft(v === true)} />
        <Label htmlFor={draftId} className="text-xs">
          {t('Create as draft')}
        </Label>
      </div>
      {defaults && defaults.commitCount === 0 && !error && (
        <p className="text-[11px] text-muted-foreground">{t('No commits ahead of {base} yet.', { base: defaults.base })}</p>
      )}
      {blockedReason && <p className="text-[11px] break-words text-destructive">{blockedReason}</p>}
      {error && <p className="text-[11px] break-words text-destructive">{error}</p>}
      <Button size="xs" disabled={locked || !title.trim() || !base || sameAsBranch || !!blockedReason || defaults?.commitCount === 0} onClick={() => void create()} data-create-review-submit>
        {busy === 'push'
          ? t('Pushing…')
          : busy === 'create'
            ? t('Creating…')
            : needsPush
              ? t('Push & Create {kind}', { kind: label })
              : t('Create {kind}', { kind: label })}
      </Button>
    </div>
  )
}
