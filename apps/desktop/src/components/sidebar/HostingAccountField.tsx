import { useState } from 'react'
import { AlertTriangle, ExternalLink, Loader2, Terminal } from 'lucide-react'
import { toast } from 'sonner'
import { HARNESS_METHODS, type HostingAccount, type HostingAccountRef, type HostingRemoteInfo } from '@zomfy/protocol'
import { harnessRequest } from '@/daemon-connection'
import type { HostId } from '@/session-store'
import {
  ACTIVE_ACCOUNT,
  ADD_ACCOUNT,
  accountChoiceNeeded,
  accountFromValue,
  accountsForRemote,
  accountValue,
  activeLogin,
  gitlabTokenPage,
  sameAccount
} from '@/lib/hosting-account-choice'
import { openAccountLogin, useHostAccounts } from '@/lib/hosting-accounts'
import { openExternalUrl } from '@/lib/link-routing'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { t } from '@/i18n/i18n'

// The project's GitHub or GitLab account (docs/specs/project-hosting-accounts.md), in Project
// Settings and the Add a project dialog: the CLI's active account by default, any other account the
// host holds, or a new one added in place.

const hint = 'text-[11px] text-muted-foreground'

function providerName(provider: HostingAccountRef['provider']): string {
  return provider === 'github' ? 'GitHub' : 'GitLab'
}

function accountNote(account: HostingAccount): string | null {
  if (account.problem) return t('needs signing in again')
  if (account.source === 'zomfy') return t('Zomfy token')
  if (account.active) return t('active')
  return null
}

export function HostingAccountField({
  id,
  hostId,
  remote,
  value,
  onChange,
  workspaceId,
  onLoginOpened,
  readOnlyWhenSingle = false,
  disabled = false
}: {
  id: string
  hostId: HostId
  /** What the project's remote (or the URL) points at; null shows why there is nothing to pick. */
  remote: HostingRemoteInfo | null
  value: HostingAccountRef | null
  onChange: (account: HostingAccountRef | null) => void
  /** Where a sign-in terminal opens; the host's floating workspace when absent. */
  workspaceId?: string
  /** A sign-in terminal opened: the dialog around the field closes so it can be seen. */
  onLoginOpened?: () => void
  /** With one account for the remote, say who it acts as instead of asking (the Add dialog). */
  readOnlyWhenSingle?: boolean
  disabled?: boolean
}) {
  const { accounts, unsupported, cli, reload } = useHostAccounts(hostId, remote !== null)
  const [adding, setAdding] = useState(false)

  if (!remote) {
    return (
      <Select disabled>
        <SelectTrigger id={id} className="w-full" data-project-account="none">
          <SelectValue placeholder={t('No GitHub or GitLab remote')} />
        </SelectTrigger>
        <SelectContent />
      </Select>
    )
  }
  if (unsupported) return <p className={hint}>{t("This host's Zomfy is too old to pick an account; update it to choose one.")}</p>

  const forRemote = accountsForRemote(accounts ?? [], remote)
  const active = activeLogin(forRemote)
  const missing = value && !forRemote.some((a) => sameAccount(a, value)) ? value : null
  const toolMissing = cli !== null && !(remote.provider === 'github' ? cli.gh : cli.glab)

  const addForm = adding ? (
    <AddAccount
      hostId={hostId}
      remote={remote}
      workspaceId={workspaceId}
      glabSignedIn={forRemote.some((a) => a.source === 'glab')}
      onCancel={() => setAdding(false)}
      onLoginOpened={() => {
        setAdding(false)
        onLoginOpened?.()
      }}
      onAdded={async (account) => {
        setAdding(false)
        await reload()
        onChange(account)
      }}
    />
  ) : null

  if (readOnlyWhenSingle && !accountChoiceNeeded(forRemote) && !missing && accounts !== null) {
    const only = forRemote[0]
    return (
      <div className="space-y-2" data-project-account="single">
        <div className="flex min-h-8 items-center gap-2 text-sm">
          <span className="min-w-0 truncate">
            {only
              ? t('As {login} on {host}', { login: only.login, host: remote.host })
              : toolMissing
                ? t('{tool} is not installed on this host', { tool: remote.provider === 'github' ? 'gh' : 'glab' })
                : t('No {provider} account signed in on this host', { provider: providerName(remote.provider) })}
          </span>
          {!adding && (
            <Button type="button" variant="link" size="sm" className="h-auto shrink-0 px-0 text-xs" onClick={() => setAdding(true)} data-account-add>
              {t('Add account…')}
            </Button>
          )}
        </div>
        {addForm}
      </div>
    )
  }

  return (
    <div className="space-y-2" data-project-account={value ? accountValue(value) : 'active'}>
      <Select
        value={value ? accountValue(value) : ACTIVE_ACCOUNT}
        disabled={disabled || accounts === null}
        onValueChange={(next) => {
          if (next === ADD_ACCOUNT) return setAdding(true)
          onChange(next === ACTIVE_ACCOUNT ? null : accountFromValue(next))
        }}
      >
        <SelectTrigger id={id} className="w-full">
          {accounts === null ? (
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" />
              {t('Reading accounts…')}
            </span>
          ) : (
            <SelectValue />
          )}
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ACTIVE_ACCOUNT}>{active ? t("The CLI's active account ({login})", { login: active }) : t("The CLI's active account")}</SelectItem>
          {forRemote.map((account) => {
            const note = accountNote(account)
            return (
              <SelectItem key={accountValue(account)} value={accountValue(account)}>
                <span className="truncate">{account.login}</span>
                {note && <span className="text-xs text-muted-foreground">{note}</span>}
              </SelectItem>
            )
          })}
          {missing && (
            <SelectItem value={accountValue(missing)}>
              {t('{login} (not signed in here)', { login: missing.login })}
            </SelectItem>
          )}
          <SelectSeparator />
          <SelectItem value={ADD_ACCOUNT} data-account-add>
            {t('Add account…')}
          </SelectItem>
        </SelectContent>
      </Select>
      {addForm}
      {!adding && missing && (
        <p className={cn(hint, 'flex items-center gap-1 text-amber-600 dark:text-amber-400')} data-account-missing>
          <AlertTriangle className="size-3 shrink-0" aria-hidden="true" />
          {t('{login} (not signed in here)', { login: missing.login })}
        </p>
      )}
    </div>
  )
}

function AddAccount({
  hostId,
  remote,
  workspaceId,
  glabSignedIn,
  onCancel,
  onLoginOpened,
  onAdded
}: {
  hostId: HostId
  remote: HostingRemoteInfo
  workspaceId?: string
  glabSignedIn: boolean
  onCancel: () => void
  onLoginOpened: () => void
  onAdded: (account: HostingAccountRef) => Promise<void>
}) {
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function signIn() {
    setBusy(true)
    try {
      await openAccountLogin(hostId, remote.provider, remote.host, workspaceId)
      toast.info(t('Finish signing in in the terminal'))
      onLoginOpened()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function addToken() {
    setBusy(true)
    setError(null)
    try {
      const account = await harnessRequest(HARNESS_METHODS.hostingAccountAddToken, { provider: 'gitlab', host: remote.host, token }, hostId)
      setToken('')
      await onAdded(account)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const terminalButton = (label: string) => (
    <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void signIn()} data-account-login>
      <Terminal className="size-3.5" />
      {label}
    </Button>
  )

  return (
    <div className="space-y-2 rounded-md border border-border/70 bg-muted/25 p-3" data-account-add-form={remote.provider}>
      {remote.provider === 'github' ? (
        <>
          <div className="flex flex-wrap gap-2">
            {terminalButton(t('Sign in with gh'))}
            <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
              {t('Cancel')}
            </Button>
          </div>
        </>
      ) : (
        <>
          {/* Not a form: it sits inside Project Settings' own, and Enter must add the token, not save. */}
          <div
            className="flex gap-2"
            onKeyDown={(e) => {
              if (e.key !== 'Enter' || e.nativeEvent.isComposing) return
              e.preventDefault()
              e.stopPropagation()
              if (token.trim() && !busy) void addToken()
            }}
          >
            <Input
              type="password"
              value={token}
              onChange={(e) => {
                setToken(e.target.value)
                setError(null)
              }}
              placeholder={t('Personal access token for {host}', { host: remote.host })}
              className="h-8 flex-1 font-mono text-xs placeholder:font-sans"
              autoComplete="off"
              spellCheck={false}
              disabled={busy}
              autoFocus
              data-account-token
            />
            <Button type="button" size="sm" className="h-8" disabled={!token.trim() || busy} onClick={() => void addToken()}>
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : null}
              {t('Add')}
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <button type="button" className={cn(hint, 'inline-flex items-center gap-1 hover:text-foreground')} onClick={() => openExternalUrl(gitlabTokenPage(remote.host))}>
              <ExternalLink className="size-3" />
              {t('Create a token on {host} (api, read_repository, write_repository)', { host: remote.host })}
            </button>
            {!glabSignedIn && (
              <button type="button" className={cn(hint, 'inline-flex items-center gap-1 hover:text-foreground')} onClick={() => void signIn()}>
                <Terminal className="size-3" />
                {t('Sign in with glab instead')}
              </button>
            )}
            <button type="button" className={cn(hint, 'ml-auto hover:text-foreground')} onClick={onCancel}>
              {t('Cancel')}
            </button>
          </div>
        </>
      )}
      {error && <p className="text-[11px] break-words text-destructive">{error}</p>}
    </div>
  )
}
