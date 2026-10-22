import { useRef, useState } from 'react'
import { invoke, isTauri } from '@tauri-apps/api/core'
import { AlertTriangle, Check, FolderOpen, Loader2, RefreshCw } from 'lucide-react'
import type { PluginCapabilityKind, PluginListEntry } from '@acp-harness/protocol'
import { LOCAL_HOST } from '@/session-store'
import { loadPlugins, pluginCommandUnavailableReason, setPluginEnabled, usePlugins } from '@/plugins/plugin-registry'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { SearchableSetting } from './SettingsSection'

// Orca's PluginsSettingsSection / PluginSettingsRow / PluginConsentDialog for plugins installed as
// folders in this computer's harness home. No marketplace and no downloads: the user copies a
// plugin folder in, reviews what it may do, and enables it.

/** Orca's PLUGIN_CAPABILITY_DESCRIPTIONS, with what the harness actually grants. */
const CAPABILITY_COPY: Record<PluginCapabilityKind, { text: string; available: boolean }> = {
  'workspace:read': { text: 'Read the name, branch, and terminal list of your focused workspace', available: true },
  'terminal:send': { text: 'Type text into a terminal you can see', available: false },
  'notifications:show': { text: 'Show desktop notifications labeled with the plugin name', available: true },
  storage: { text: "Store data in the plugin's own storage folder", available: false },
  secrets: { text: "Store and read secrets in the plugin's own encrypted vault", available: false },
  'events:subscribe': { text: 'Get notified when workspaces are created or removed and when agent status changes', available: false },
  'settings:own': { text: "Read and change the plugin's own settings", available: false }
}

function statusBadge(plugin: PluginListEntry): { label: string; className: string } {
  switch (plugin.status) {
    case 'enabled':
      return { label: 'Enabled', className: 'border-status-success-border bg-status-success-background text-status-success' }
    case 'needs-review':
      return { label: 'Needs review', className: 'border-foreground/20 bg-foreground/8 text-foreground' }
    case 'invalid':
      return { label: 'Invalid', className: 'border-destructive/25 bg-destructive/8 text-destructive' }
    default:
      return { label: 'Disabled', className: 'border-border bg-muted/40 text-muted-foreground' }
  }
}

function PluginAvatar({ name }: { name: string }) {
  return (
    <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-muted/50 text-sm font-semibold text-muted-foreground uppercase">
      {name.trim().charAt(0) || '?'}
    </span>
  )
}

function openFolder(path: string): void {
  if (!isTauri()) return
  void invoke('open_workspace_in', { target: 'explorer', host: LOCAL_HOST, path }).catch((e: unknown) => window.alert(String(e)))
}

function PluginRow({ plugin, onReview }: { plugin: PluginListEntry; onReview: (plugin: PluginListEntry) => void }) {
  const [busy, setBusy] = useState(false)
  const status = statusBadge(plugin)
  const manifest = plugin.manifest
  const needsReview = plugin.status === 'disabled' || plugin.status === 'needs-review'
  const contributions = manifest
    ? [
        manifest.contributes.panels.length ? `${manifest.contributes.panels.length} panel${manifest.contributes.panels.length === 1 ? '' : 's'}` : null,
        manifest.contributes.commands.length ? `${manifest.contributes.commands.length} command${manifest.contributes.commands.length === 1 ? '' : 's'}` : null
      ].filter(Boolean)
    : []
  return (
    <article className="flex flex-col rounded-xl border border-border/80 bg-card p-4 text-card-foreground shadow-xs" data-plugin-key={plugin.pluginKey}>
      <div className="flex items-start gap-3">
        <PluginAvatar name={manifest?.name ?? plugin.pluginKey} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <h4 className="text-sm font-semibold">{manifest?.name ?? plugin.pluginKey}</h4>
            <span className={cn('inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium', status.className)}>{status.label}</span>
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {manifest ? `v${manifest.version} · ${manifest.publisher}` : plugin.rootDir}
            {contributions.length ? ` · ${contributions.join(', ')}` : ''}
          </p>
          {manifest?.description ? <p className="mt-2 text-xs leading-5 text-muted-foreground">{manifest.description}</p> : null}
          {plugin.error ? <p className="mt-2 text-xs text-destructive">{plugin.error}</p> : null}
        </div>
        {plugin.status === 'enabled' ? (
          <Switch
            checked
            disabled={busy}
            aria-label={`Disable ${manifest?.name ?? plugin.pluginKey}`}
            onCheckedChange={() => {
              setBusy(true)
              void setPluginEnabled(plugin, false)
                .catch((e: unknown) => window.alert(String(e)))
                .finally(() => setBusy(false))
            }}
          />
        ) : null}
      </div>
      <div className="mt-3 flex items-center gap-2">
        {needsReview ? (
          <Button variant="secondary" size="sm" onClick={() => onReview(plugin)}>
            Review &amp; enable
          </Button>
        ) : null}
        <Button variant="ghost" size="sm" className="ml-auto text-muted-foreground" onClick={() => openFolder(plugin.rootDir)}>
          <FolderOpen className="size-3.5" />
          Open folder
        </Button>
      </div>
    </article>
  )
}

function PluginConsentDialog({ plugin, onClose }: { plugin: PluginListEntry | null; onClose: () => void }) {
  const keepDisabled = useRef<HTMLButtonElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const manifest = plugin?.manifest
  if (!plugin || !manifest) return null
  const enable = async () => {
    setBusy(true)
    setError(null)
    try {
      await setPluginEnabled(plugin, true)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }
  const { panels, commands } = manifest.contributes
  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent
        className="scrollbar-sleek max-h-[calc(100vh-3rem)] overflow-y-auto sm:max-w-xl"
        data-plugin-consent
        onOpenAutoFocus={(event) => {
          // Dismissal is the safe path, so it gets initial focus.
          event.preventDefault()
          keepDisabled.current?.focus()
        }}
      >
        <DialogHeader>
          <DialogTitle>Enable {manifest.name}?</DialogTitle>
          <DialogDescription>
            {manifest.name} v{manifest.version} · {manifest.publisher}
          </DialogDescription>
        </DialogHeader>
        {plugin.status === 'needs-review' ? (
          <p className="border-l-2 border-foreground/25 py-0.5 pl-3 text-sm leading-6">
            Permissions or contributions changed since you last reviewed this plugin. Review it again before it can run.
          </p>
        ) : null}
        {manifest.capabilities.length > 0 ? (
          <div className="space-y-2">
            <p className="text-[11px] font-semibold tracking-[0.05em] text-muted-foreground uppercase">This plugin can</p>
            {manifest.capabilities.map(({ kind }) => (
              <div key={kind} className="flex items-start gap-2 text-sm leading-6">
                <Check className="mt-1 size-3.5 shrink-0 text-muted-foreground" />
                <span>
                  {CAPABILITY_COPY[kind].text} <span className="font-mono text-[11px] text-muted-foreground">({kind})</span>
                  {!CAPABILITY_COPY[kind].available ? <span className="text-xs text-muted-foreground"> — not offered by acp-harness yet</span> : null}
                </span>
              </div>
            ))}
          </div>
        ) : null}
        {panels.length > 0 || commands.length > 0 ? (
          <div className="space-y-2">
            <p className="text-[11px] font-semibold tracking-[0.05em] text-muted-foreground uppercase">It adds</p>
            {panels.map((panel) => (
              <p key={`panel-${panel.id}`} className="text-sm leading-6">
                Right sidebar panel <span className="font-medium">{panel.title}</span>
              </p>
            ))}
            {commands.map((command) => {
              const reason = pluginCommandUnavailableReason(command.action)
              const keys = manifest.contributes.keybindings.filter((k) => k.command === command.id).map((k) => k.key)
              return (
                <p key={`command-${command.id}`} className="text-sm leading-6">
                  Command <span className="font-medium">{command.title}</span>
                  {keys.length ? <span className="font-mono text-[11px] text-muted-foreground"> {keys.join(', ')}</span> : null}
                  {reason ? <span className="block text-xs text-muted-foreground">{reason}</span> : null}
                </p>
              )
            })}
          </div>
        ) : null}
        <div className="flex items-start gap-2 rounded-md border border-border bg-muted/50 px-3.5 py-3 text-sm leading-6">
          <AlertTriangle className="mt-1 size-4 shrink-0" />
          <span>
            {manifest.main
              ? 'This plugin ships a background worker. acp-harness does not run plugin workers, so only its panels and declarative commands take effect.'
              : "These permissions limit how the plugin uses acp-harness. Panels run in a sandbox with no network access; the plugin has no background worker."}
          </span>
        </div>
        {error ? <p className="text-xs text-destructive">{error}</p> : null}
        <DialogFooter>
          <Button ref={keepDisabled} variant="ghost" size="sm" disabled={busy} onClick={onClose}>
            Keep Disabled
          </Button>
          <Button size="sm" disabled={busy} onClick={() => void enable()}>
            {busy ? <Loader2 className="animate-spin" /> : null}
            Enable plugin
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function PluginsPane() {
  const state = usePlugins((s) => s)
  const [reviewing, setReviewing] = useState<PluginListEntry | null>(null)
  const plugins = state.snapshot?.plugins ?? []
  return (
    <div className="space-y-5">
      <SearchableSetting entry={{ title: 'Plugins folder', keywords: ['plugin', 'install', 'folder', 'orca-plugin.json'] }}>
        <div className="flex items-start gap-4 py-2">
          <div className="min-w-0 flex-1 space-y-1">
            <p className="text-sm font-medium">Plugins folder</p>
            <p className="text-xs text-muted-foreground">
              Copy a plugin folder (with its <span className="font-mono">orca-plugin.json</span>) here, then refresh. Nothing is downloaded.
            </p>
            {state.snapshot ? <p className="font-mono text-[11px] break-all text-muted-foreground">{state.snapshot.pluginsDir}</p> : null}
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <Button variant="outline" size="sm" disabled={!state.snapshot} onClick={() => state.snapshot && openFolder(state.snapshot.pluginsDir)}>
              <FolderOpen className="size-3.5" />
              Open
            </Button>
            <Button variant="ghost" size="icon-sm" aria-label="Refresh plugins" disabled={state.status === 'loading'} onClick={() => void loadPlugins()}>
              <RefreshCw className={state.status === 'loading' ? 'animate-spin' : undefined} />
            </Button>
          </div>
        </div>
      </SearchableSetting>
      {state.error ? <p className="text-xs text-destructive">{state.error}</p> : null}
      <SearchableSetting entry={{ title: 'Installed plugins', keywords: ['plugin', 'enable', 'disable', 'panel', 'command'] }}>
        {plugins.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border/70 px-6 py-10 text-center" data-plugins-empty>
            <Badge variant="outline">No plugins</Badge>
            <p className="max-w-sm text-xs leading-5 text-muted-foreground">
              Plugins add right-sidebar panels and commands. Put one in the plugins folder above to get started.
            </p>
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2" data-plugins-list>
            {plugins.map((plugin) => (
              <PluginRow key={plugin.rootDir} plugin={plugin} onReview={setReviewing} />
            ))}
          </div>
        )}
      </SearchableSetting>
      <PluginConsentDialog key={reviewing?.pluginKey ?? 'none'} plugin={reviewing} onClose={() => setReviewing(null)} />
    </div>
  )
}
