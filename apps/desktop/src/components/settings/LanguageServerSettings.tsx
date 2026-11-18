import { useCallback, useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { HARNESS_METHODS, type LspServerStatus, type LspSetServerParams } from '@acp-harness/protocol'
import { harnessRequest } from '@/daemon-connection'
import type { HostEntry } from '@/session-store'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import { SettingsRow, TextField } from './settings-form-controls'
import { SearchableSetting } from './SettingsSection'
import { t } from '@/i18n/i18n'

// Per host, the language servers the editor uses there: what was found for each known one, the
// person's own command in its place, and servers added for languages Zomfy does not know. Nothing
// here installs anything; a server that is missing shows the command that would install it.

export function LanguageServerSettings({ host }: { host: HostEntry }) {
  const [servers, setServers] = useState<LspServerStatus[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(() => {
    setLoading(true)
    harnessRequest(HARNESS_METHODS.lspServers, {}, host.id)
      .then(
        (list) => {
          setServers(list)
          setError(null)
        },
        (e: unknown) => setError(e instanceof Error ? e.message : String(e))
      )
      .finally(() => setLoading(false))
  }, [host.id])

  useEffect(load, [load])

  const save = (params: LspSetServerParams) =>
    harnessRequest(HARNESS_METHODS.lspSetServer, params, host.id).then(
      (list) => {
        setServers(list)
        setError(null)
      },
      (e: unknown) => setError(e instanceof Error ? e.message : String(e))
    )

  return (
    <div className="space-y-1" data-language-server-settings={host.id}>
      <div className="flex items-center justify-between gap-2 pt-2">
        <span className="text-xs font-medium text-muted-foreground">{host.label}</span>
        <Button type="button" variant="ghost" size="xs" disabled={loading} onClick={load}>
          <RefreshCw className={cn('size-3', loading && 'animate-spin')} />
          {t('Reload')}
        </Button>
      </div>
      {error ? <p className="py-1 text-xs text-destructive">{error}</p> : null}
      <div className="divide-y divide-border/40">
        {(servers ?? []).map((server) => (
          <ServerRow key={server.id} server={server} onSave={save} />
        ))}
      </div>
      {servers ? <AddServer taken={servers.map((s) => s.id)} onSave={save} /> : null}
    </div>
  )
}

function ServerRow({ server, onSave }: { server: LspServerStatus; onSave: (params: LspSetServerParams) => Promise<void> }) {
  const found = server.resolved !== null
  return (
    <div className="py-1" data-language-server={server.id} data-language-server-found={found}>
      <SearchableSetting entry={{ title: server.name, keywords: ['language server', 'lsp', server.id, ...server.languages] }}>
        <div className="flex items-center gap-2 pt-2">
          <span className="text-sm font-medium">{server.name}</span>
          <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
            {server.role === 'linter' ? `${t('Linter')} · ` : ''}
            {server.languages.join(', ')}
          </span>
          {!server.builtin ? (
            <Button type="button" variant="ghost" size="xs" onClick={() => void onSave({ id: server.id, remove: true })}>
              {t('Remove')}
            </Button>
          ) : null}
          <Switch checked={!server.disabled} aria-label={t('Use {name}', { name: server.name })} onCheckedChange={(checked) => void onSave({ id: server.id, disabled: !checked })} />
        </div>
        <p className={cn('font-mono text-xs break-all', found ? 'text-muted-foreground' : 'text-status-warning')} data-language-server-status>
          {found ? server.resolved : server.detail}
        </p>
        {!found && server.install ? <p className="text-xs text-muted-foreground">{t('To install it on this host: {command}', { command: server.install })}</p> : null}
      </SearchableSetting>
      <TextField
        label={t('{name} command', { name: server.name })}
        description={server.builtin ? t('Starts this language server over stdio. Empty looks for it on the host.') : t('Starts this language server over stdio.')}
        keywords={['language server', 'lsp', 'command', server.id]}
        value={server.command ?? ''}
        placeholder={server.builtin ? t('Found automatically') : ''}
        className="w-72 font-mono text-xs"
        onChange={(value) => {
          // An added server is nothing without its command; clearing it would be removing it.
          if (value || server.builtin) void onSave({ id: server.id, command: value || null })
        }}
      />
    </div>
  )
}

/** A server for a language Zomfy has no entry for: its languages (editor language ids or `.ext`) and its command. */
function AddServer({ taken, onSave }: { taken: string[]; onSave: (params: LspSetServerParams) => Promise<void> }) {
  const [name, setName] = useState('')
  const [languages, setLanguages] = useState('')
  const [command, setCommand] = useState('')
  const id = name.trim()
  const list = languages
    .split(/[\s,]+/)
    .map((language) => language.trim())
    .filter(Boolean)
  const ready = id !== '' && !taken.includes(id) && list.length > 0 && command.trim() !== ''
  return (
    <SettingsRow
      label={t('Add a language server')}
      description={t('For a language not listed: its name, the languages or file extensions it serves (ruby, .zig), and the command that starts it over stdio.')}
      keywords={['language server', 'lsp', 'add', 'custom', 'command']}
      alignTop
      control={
        <div className="w-72 space-y-2" data-language-server-add>
          <Input value={name} onChange={(e) => setName(e.target.value)} aria-label={t('Language server name')} placeholder={t('Name')} spellCheck={false} className="h-7 text-xs" />
          <Input
            value={languages}
            onChange={(e) => setLanguages(e.target.value)}
            aria-label={t('Languages or file extensions')}
            placeholder="ruby, .zig"
            spellCheck={false}
            className="h-7 font-mono text-xs"
          />
          <Input
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            aria-label={t('Language server command')}
            placeholder="zls"
            spellCheck={false}
            className="h-7 font-mono text-xs"
          />
          <Button
            type="button"
            size="xs"
            disabled={!ready}
            onClick={() =>
              void onSave({ id, languages: list, command: command.trim() }).then(() => {
                setName('')
                setLanguages('')
                setCommand('')
              })
            }
          >
            {t('Add')}
          </Button>
        </div>
      }
    />
  )
}
