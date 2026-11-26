import { useEffect, useMemo, useState } from 'react'
import { Bot, RotateCcw } from 'lucide-react'
import { CLOUDFLARE_MCP_URL, HARNESS_METHODS } from '@zomfy/protocol'
import { createSession, harnessRequest, sendPrompt } from '@/daemon-connection'
import { allProjects, allWorkspaces, getState, LOCAL_HOST, selectSession, selectWorkspace, setHarnessState, useStore } from '@/session-store'
import { closeSettings } from '@/stores/app-overlay-store'
import { relayFeatureInfo, relayFeatureList, ZOMFY_REPO } from '@/lib/relay-features'
import { buildRelaySetupPrompt, type RelayPromptLanguage } from '@/lib/relay-setup-prompt'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { LANGUAGE, t } from '@/i18n/i18n'

// Settings → Zomfy Relay → Set up with an agent (docs/specs/relay-settings.md#set-up-with-an-agent):
// a Claude chat in a Zomfy checkout, optionally with Cloudflare's MCP server, and an editable prompt.

const CLONE = 'clone'

interface Checkout {
  workspaceId: string
  name: string
  path: string
}

/** This computer's projects whose folder has the relay in it. */
function useZomfyCheckouts(open: boolean): Checkout[] | null {
  const hosts = useStore((s) => s.hosts)
  const [found, setFound] = useState<Checkout[] | null>(null)
  useEffect(() => {
    if (!open) return
    let cancelled = false
    const names = new Map(allProjects(hosts).map((p) => [`${p.hostId}:${p.id}`, p.displayName ?? p.name]))
    const primaries = allWorkspaces({ hosts }).filter((w) => w.hostId === LOCAL_HOST && w.isPrimary && w.projectId)
    void Promise.all(
      primaries.map((w) =>
        harnessRequest(HARNESS_METHODS.fsStat, { workspaceId: w.id, path: 'apps/relay/wrangler.jsonc' }, LOCAL_HOST).then(
          () => ({ workspaceId: w.id, name: names.get(`${w.hostId}:${w.projectId}`) ?? w.name, path: w.path }),
          () => null
        )
      )
    ).then((list) => {
      if (!cancelled) setFound(list.filter((c): c is Checkout => c !== null))
    })
    return () => {
      cancelled = true
    }
  }, [open, hosts])
  return found
}

/** Clones Zomfy into the host's clone folder, or adds that folder when it is already there; returns its primary workspace. */
async function cloneZomfy(): Promise<string> {
  let project
  try {
    project = await harnessRequest(HARNESS_METHODS.projectClone, { url: `${ZOMFY_REPO}.git`, name: 'zomfy' }, LOCAL_HOST)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (!message.includes('already exists')) throw error
    const { cloneParent } = await harnessRequest(HARNESS_METHODS.projectCreationDefaults, {}, LOCAL_HOST)
    const sep = cloneParent.includes('\\') ? '\\' : '/'
    project = await harnessRequest(HARNESS_METHODS.projectAdd, { path: `${cloneParent.replace(/[\\/]+$/, '')}${sep}zomfy` }, LOCAL_HOST)
  }
  // The state broadcast may trail the reply; the primary workspace must be known to start a chat in it.
  const state = await harnessRequest(HARNESS_METHODS.stateGet, {}, LOCAL_HOST).catch(() => null)
  if (state) setHarnessState(LOCAL_HOST, state)
  const workspaces = (state ?? getState().hosts[LOCAL_HOST]?.harness)?.workspaces ?? []
  const primary = workspaces.find((w) => w.projectId === project.id && w.isPrimary)
  if (!primary) throw new Error(t('The project has no folder to start a thread in.'))
  return primary.id
}

export function RelaySetupDialog({
  open,
  onOpenChange,
  features,
  relayUrl
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  features: readonly string[]
  relayUrl: string | null
}) {
  const checkouts = useZomfyCheckouts(open)
  const [place, setPlace] = useState<string | null>(null)
  const [language, setLanguage] = useState<RelayPromptLanguage>(LANGUAGE)
  const [cloudflareMcp, setCloudflareMcp] = useState(false)
  const [edited, setEdited] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const chosen = relayFeatureList(features)
  const labels = useMemo(() => new Map(relayFeatureInfo().map((f) => [f.id, f.label])), [])
  const where = place ?? checkouts?.[0]?.workspaceId ?? CLONE
  const built = buildRelaySetupPrompt({ features: chosen, language, place: where === CLONE ? 'clone' : 'checkout', cloudflareMcp, relayUrl })
  const prompt = edited ?? built

  useEffect(() => {
    if (!open) {
      setEdited(null)
      setError(null)
      setPlace(null)
    }
  }, [open])

  const start = async () => {
    setBusy(true)
    setError(null)
    try {
      const workspaceId = where === CLONE ? await cloneZomfy() : where
      const sessionId = await createSession(workspaceId, 'claude', {
        hostId: LOCAL_HOST,
        ...(cloudflareMcp ? { connectors: ['cloudflare' as const] } : {})
      })
      closeSettings()
      selectWorkspace(workspaceId)
      selectSession(sessionId)
      onOpenChange(false)
      await sendPrompt(sessionId, prompt)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl" data-relay-setup-dialog>
        <DialogHeader>
          <DialogTitle>{t('Set up Zomfy Relay with an agent')}</DialogTitle>
          <DialogDescription>
            {t('Starts a Claude chat that deploys and configures your relay step by step. It asks you for every secret and never shows one back.')}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 text-sm">
          <div className="grid gap-1">
            <p className="text-xs text-muted-foreground">{t('Features')}</p>
            <p data-relay-setup-features>{chosen.map((f) => labels.get(f) ?? f).join(', ') || t('None ticked')}</p>
            <p className="text-[11px] text-muted-foreground">{t('Change them on the Zomfy Relay page.')}</p>
          </div>

          <div className="grid gap-1">
            <p className="text-xs text-muted-foreground">{t('Where')}</p>
            <Select value={where} onValueChange={(value) => setPlace(value)}>
              <SelectTrigger className="w-full" data-relay-setup-place>
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper">
                {(checkouts ?? []).map((c) => (
                  <SelectItem key={c.workspaceId} value={c.workspaceId}>
                    {c.name} <span className="text-muted-foreground">· {c.path}</span>
                  </SelectItem>
                ))}
                <SelectItem value={CLONE}>{t('Clone Zomfy into a new folder')}</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">
              {checkouts === null
                ? t('Looking for a Zomfy checkout on this computer…')
                : checkouts.length === 0
                  ? t('No Zomfy checkout among your projects: the chat starts in a fresh clone of {repo}.', { repo: ZOMFY_REPO })
                  : t('A project on this computer with apps/relay in it.')}
            </p>
          </div>

          <label className="flex items-start gap-2" data-relay-setup-mcp>
            <Checkbox className="mt-0.5" checked={cloudflareMcp} onCheckedChange={(v) => setCloudflareMcp(v === true)} />
            <span className="grid gap-0.5">
              <span>{t('Give this chat Cloudflare’s MCP server')}</span>
              <span className="text-[11px] text-muted-foreground">
                {t(
                  'The server of Cloudflare’s own agent plugin (cloudflare@claude-plugins-official), at {url}, which covers the whole Cloudflare API. It is added to this chat only; sign in to Cloudflare from the chat’s Connectors when it asks. Without it the agent uses wrangler.',
                  { url: CLOUDFLARE_MCP_URL }
                )}
              </span>
            </span>
          </label>

          <div className="grid gap-1">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">{t('Prompt')}</p>
              <div className="flex items-center gap-2">
                <div className="flex overflow-hidden rounded-md border border-border/60 text-xs" role="radiogroup" aria-label={t('Prompt language')}>
                  {(['en', 'ja'] as const).map((lang) => (
                    <button
                      key={lang}
                      type="button"
                      role="radio"
                      aria-checked={language === lang}
                      data-relay-setup-language={lang}
                      className={cn('px-2 py-0.5', language === lang ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent/40')}
                      onClick={() => {
                        setLanguage(lang)
                        setEdited(null)
                      }}
                    >
                      {lang === 'en' ? 'English' : '日本語'}
                    </button>
                  ))}
                </div>
                <Button type="button" size="xs" variant="ghost" disabled={edited === null} onClick={() => setEdited(null)} data-relay-setup-reset>
                  <RotateCcw />
                  {t('Reset prompt')}
                </Button>
              </div>
            </div>
            <Textarea
              rows={14}
              value={prompt}
              data-relay-setup-prompt
              className="font-mono text-xs"
              onChange={(e) => setEdited(e.target.value)}
            />
            {edited !== null ? <p className="text-[11px] text-muted-foreground">{t('Edited: changing a choice above no longer rewrites it.')}</p> : null}
          </div>
          {error ? <p className="text-xs text-destructive">{error}</p> : null}
        </div>

        <DialogFooter>
          <Button variant="ghost" disabled={busy} onClick={() => onOpenChange(false)}>
            {t('Cancel')}
          </Button>
          <Button disabled={busy || chosen.length === 0 || !prompt.trim()} onClick={() => void start()} data-relay-setup-start>
            <Bot />
            {busy ? (where === CLONE ? t('Cloning…') : t('Starting…')) : t('Start chat')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
