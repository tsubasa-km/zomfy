import { useEffect, useState } from 'react'
import { invoke, isTauri } from '@tauri-apps/api/core'
import { FileDown, Pencil, Plus, Server, SquareTerminal, Trash2 } from 'lucide-react'
import { SSH_CONNECTION_TAGS, sshConnectionHostError, type SshConnection, type SshConnectionInput, type SshConnectionTag } from '@zomfy/protocol'
import { LOCAL_HOST } from '@/session-store'
import {
  closeSshConnectionsDialog,
  deleteSshConnection,
  openSshConnection,
  saveSshConnection,
  sshDestination,
  useSshConnections,
  useSshConnectionsDialog,
  workspaceHost
} from '@/lib/ssh-connections'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { SshTagBadge } from './SshTagBadge'
import { useSaveState } from '@/lib/use-save-state'
import { t } from '@/i18n/i18n'

// RLogin's server list: saved logins, in folders, each tagged with how careful to be there. A login
// opens as a terminal tab running the host's own ssh, so keys, ssh-agent and ProxyJump all apply.

interface SshConfigHost {
  alias: string
  hostname: string | null
  user: string | null
  port: number | null
}

const EMPTY: SshConnectionInput = { name: '', host: '', port: null, user: null, identityFile: null, proxyJump: null, group: null, tag: null }
const NO_TAG = 'none'

export function SshConnectionsDialog() {
  const { open, workspaceId } = useSshConnectionsDialog()
  const hostId = workspaceHost(workspaceId)
  const connections = useSshConnections(hostId)
  const [editing, setEditing] = useState<{ id?: string; draft: SshConnectionInput } | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (!open) setEditing(null)
    setError(null)
  }, [open])

  const fail = (e: unknown) => setError(e instanceof Error ? e.message : String(e))
  const groups = groupConnections(connections ?? [])
  return (
    <Dialog open={open} onOpenChange={(next) => !next && closeSshConnectionsDialog()}>
      <DialogContent className="max-w-2xl gap-0 overflow-hidden p-0" data-ssh-connections>
        <DialogHeader className="space-y-1 border-b border-border py-4 pr-10 pl-5">
          <DialogTitle className="text-base">{t('SSH connections')}</DialogTitle>
          <DialogDescription className="text-xs">
            {t('Servers you log in to. Each opens as a terminal tab running this computer’s ssh, so your keys, ssh-agent and jump hosts apply.')}
          </DialogDescription>
        </DialogHeader>
        <div className="scrollbar-sleek max-h-[65vh] overflow-y-auto px-5 py-4">
          {editing ? (
            <ConnectionForm
              initial={editing.draft}
              existing={!!editing.id}
              onCancel={() => setEditing(null)}
              onSave={(draft) =>
                saveSshConnection(hostId, editing.id, draft).then(() => {
                  setEditing(null)
                  setError(null)
                }, fail)
              }
            />
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" size="sm" onClick={() => setEditing({ draft: EMPTY })} data-ssh-add>
                  <Plus className="size-3.5" />
                  {t('Add a connection')}
                </Button>
                {hostId === LOCAL_HOST ? (
                  <ImportFromConfig known={connections ?? []} onImport={(draft) => void saveSshConnection(hostId, undefined, draft).catch(fail)} />
                ) : null}
              </div>
              {connections === null ? (
                <p className="text-xs text-muted-foreground">{t('Loading…')}</p>
              ) : connections.length === 0 ? (
                <p className="text-xs text-muted-foreground">{t('No connections yet. Add one, or bring them in from ~/.ssh/config.')}</p>
              ) : (
                groups.map(({ group, items }) => (
                  <section key={group ?? ''} className="space-y-1">
                    {group ? <h3 className="text-xs font-medium text-muted-foreground">{group}</h3> : null}
                    <ul className="divide-y divide-border/50 rounded-md border border-border/60">
                      {items.map((connection) => (
                        <ConnectionRow
                          key={connection.id}
                          connection={connection}
                          canOpen={!!workspaceId}
                          onOpen={() => {
                            if (!workspaceId) return
                            void openSshConnection(workspaceId, connection.id).then(closeSshConnectionsDialog, fail)
                          }}
                          onEdit={() => setEditing({ id: connection.id, draft: { ...connection } })}
                          onDelete={() => void deleteSshConnection(hostId, connection.id).catch(fail)}
                        />
                      ))}
                    </ul>
                  </section>
                ))
              )}
              {!workspaceId && (connections?.length ?? 0) > 0 ? (
                <p className="text-xs text-muted-foreground">{t('Open a project first: a connection opens as a tab of the project in front.')}</p>
              ) : null}
            </div>
          )}
          {error ? <p className="mt-3 text-xs text-destructive">{error}</p> : null}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function groupConnections(list: SshConnection[]): { group: string | null; items: SshConnection[] }[] {
  const groups = new Map<string | null, SshConnection[]>()
  for (const connection of [...list].sort((a, b) => a.name.localeCompare(b.name))) {
    groups.set(connection.group, [...(groups.get(connection.group) ?? []), connection])
  }
  return [...groups.entries()]
    .sort(([a], [b]) => (a === null ? -1 : b === null ? 1 : a.localeCompare(b)))
    .map(([group, items]) => ({ group, items }))
}

function ConnectionRow({
  connection,
  canOpen,
  onOpen,
  onEdit,
  onDelete
}: {
  connection: SshConnection
  canOpen: boolean
  onOpen: () => void
  onEdit: () => void
  onDelete: () => void
}) {
  const [confirming, setConfirming] = useState(false)
  return (
    <li className="flex items-center gap-2 px-3 py-2 text-sm" data-ssh-connection={connection.id}>
      <Server className="size-3.5 shrink-0 text-muted-foreground" />
      <button type="button" disabled={!canOpen} onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-2 text-left disabled:cursor-default">
        <span className="truncate font-medium">{connection.name}</span>
        {connection.tag ? <SshTagBadge tag={connection.tag} /> : null}
        <span className="min-w-0 truncate font-mono text-xs text-muted-foreground">{sshDestination(connection)}</span>
      </button>
      {confirming ? (
        <>
          <Button type="button" variant="ghost" size="xs" onClick={() => setConfirming(false)}>
            {t('Cancel')}
          </Button>
          <Button type="button" variant="destructive" size="xs" onClick={onDelete} data-ssh-delete-confirm>
            {t('Delete')}
          </Button>
        </>
      ) : (
        <>
          <Button type="button" variant="outline" size="xs" disabled={!canOpen} onClick={onOpen} data-ssh-open>
            <SquareTerminal className="size-3" />
            {t('Open')}
          </Button>
          <Button type="button" variant="ghost" size="icon-xs" aria-label={t('Edit')} title={t('Edit')} onClick={onEdit}>
            <Pencil className="size-3" />
          </Button>
          <Button type="button" variant="ghost" size="icon-xs" aria-label={t('Delete')} title={t('Delete')} onClick={() => setConfirming(true)}>
            <Trash2 className="size-3" />
          </Button>
        </>
      )}
    </li>
  )
}

function ConnectionForm({
  initial,
  existing,
  onCancel,
  onSave
}: {
  initial: SshConnectionInput
  existing: boolean
  onCancel: () => void
  onSave: (draft: SshConnectionInput) => Promise<void>
}) {
  const [draft, setDraft] = useState(initial)
  // A saved login is saved again only when something differs.
  const { dirty, saving, save } = useSaveState(initial, draft, () => onSave(draft))
  const set = (patch: Partial<SshConnectionInput>) => setDraft((d) => ({ ...d, ...patch }))
  const hostError = draft.host.trim() ? sshConnectionHostError(draft.host) : null
  const portText = draft.port === null ? '' : String(draft.port)
  const field = (key: 'name' | 'host' | 'user' | 'identityFile' | 'proxyJump' | 'group', label: string, placeholder: string, mono = false) => (
    <div className="space-y-1">
      <Label htmlFor={`ssh-${key}`} className="text-xs">
        {label}
      </Label>
      <Input
        id={`ssh-${key}`}
        value={draft[key] ?? ''}
        placeholder={placeholder}
        spellCheck={false}
        className={mono ? 'h-8 font-mono text-xs' : 'h-8 text-sm'}
        onChange={(e) => set({ [key]: key === 'host' || key === 'name' ? e.target.value : e.target.value || null })}
      />
    </div>
  )
  return (
    <form
      className="space-y-3"
      data-ssh-form
      onSubmit={(e) => {
        e.preventDefault()
        if (existing && !dirty) return
        void save()
      }}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {field('host', t('Host'), t('db-1.example.com, 10.0.0.5 or a ~/.ssh/config alias'), true)}
        {field('name', t('Name'), t('Shown in the list and on the tab'))}
        {field('user', t('User'), t('From ~/.ssh/config, or your own'), true)}
        <div className="space-y-1">
          <Label htmlFor="ssh-port" className="text-xs">
            {t('Port')}
          </Label>
          <Input
            id="ssh-port"
            value={portText}
            placeholder="22"
            inputMode="numeric"
            className="h-8 font-mono text-xs"
            onChange={(e) => set({ port: e.target.value.trim() ? Number(e.target.value.replace(/\D/g, '')) || null : null })}
          />
        </div>
        {field('identityFile', t('Key file'), t('Optional: ssh-agent or ~/.ssh/config otherwise'), true)}
        {field('proxyJump', t('Jump hosts'), t('Optional: bastion, or user@a,user@b'), true)}
        {field('group', t('Folder'), t('Optional: groups connections in the list'))}
        <div className="space-y-1">
          <Label className="text-xs">{t('Environment')}</Label>
          <Select value={draft.tag ?? NO_TAG} onValueChange={(v) => set({ tag: v === NO_TAG ? null : (v as SshConnectionTag) })}>
            <SelectTrigger size="sm" className="h-8 w-full text-sm" data-ssh-tag>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_TAG}>{t('Not set')}</SelectItem>
              {SSH_CONNECTION_TAGS.map((tag) => (
                <SelectItem key={tag} value={tag}>
                  <SshTagBadge tag={tag} />
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <p className="text-[11px] text-muted-foreground">
        {t('Passwords are never saved: ssh asks for one in the tab when the server needs it. Agents that read the tab are told its environment.')}
      </p>
      {hostError ? <p className="text-xs text-destructive">{t(hostError)}</p> : null}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          {t('Cancel')}
        </Button>
        <Button type="submit" size="sm" disabled={saving || (existing && !dirty) || !draft.host.trim() || !!hostError} data-ssh-save>
          {saving ? t('Saving…') : existing ? t('Save') : t('Add')}
        </Button>
      </div>
    </form>
  )
}

/** The aliases of ~/.ssh/config not in the list yet, each added with one click. */
function ImportFromConfig({ known, onImport }: { known: SshConnection[]; onImport: (draft: SshConnectionInput) => void }) {
  const [hosts, setHosts] = useState<SshConfigHost[] | null>(null)
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (!open || hosts || !isTauri()) return
    invoke<SshConfigHost[]>('ssh_config_hosts').then(setHosts, () => setHosts([]))
  }, [open, hosts])
  if (!isTauri()) return null
  const fresh = (hosts ?? []).filter((h) => !known.some((c) => c.host === h.alias))
  return (
    <div className="contents">
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen((o) => !o)} data-ssh-import>
        <FileDown className="size-3.5" />
        {t('From ~/.ssh/config')}
      </Button>
      {open ? (
        <div className="w-full rounded-md border border-border/60 p-2 text-xs" data-ssh-import-list>
          {hosts === null ? (
            <p className="text-muted-foreground">{t('Reading ~/.ssh/config…')}</p>
          ) : fresh.length === 0 ? (
            <p className="text-muted-foreground">{t('Every host in ~/.ssh/config is in the list already.')}</p>
          ) : (
            <ul className="space-y-1">
              {fresh.map((h) => (
                <li key={h.alias} className="flex items-center gap-2">
                  <span className="font-mono">{h.alias}</span>
                  <span className="min-w-0 flex-1 truncate font-mono text-muted-foreground">{sshDestination({ host: h.hostname ?? h.alias, user: h.user, port: h.port })}</span>
                  <Button type="button" variant="ghost" size="xs" onClick={() => onImport({ ...EMPTY, name: h.alias, host: h.alias })}>
                    <Plus className="size-3" />
                    {t('Add')}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  )
}
