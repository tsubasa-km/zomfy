import { useEffect, useState } from 'react'
import { invoke, isTauri } from '@tauri-apps/api/core'
import { isPermissionGranted, requestPermission, sendNotification } from '@tauri-apps/plugin-notification'
import { Bell, Check, Download, FolderPlus, Monitor, Moon, Server, Settings2, Sun } from 'lucide-react'
import { CHAT_AGENT_IDS, chatAgentLabel, type ChatAgentId } from '@acp-harness/protocol'
import { connectHost } from '@/daemon-connection'
import { LOCAL_HOST, useStore } from '@/session-store'
import { useChatAgents } from '@/lib/chat-agents'
import { setSetting, useSetting, type ThemePreference } from '@/stores/settings-store'
import { TuiAgentIcon } from '@/components/terminal/TuiAgentIcon'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import { ChromePreview } from './theme-chrome-preview'

// Steps of Orca's onboarding (AgentStep, ThemeStep, WindowsTerminalStep, NotificationStep), fitted
// to the harness: chat agents this computer can run, WSL distros to connect, and a project to add.

function SectionHeader({ label, count }: { label: string; count?: number }) {
  return (
    <div className="flex shrink-0 items-center gap-1.5 text-xs font-medium text-muted-foreground">
      <span>{label}</span>
      {count !== undefined ? <span className="text-muted-foreground/70 tabular-nums">{count}</span> : null}
    </div>
  )
}

function AgentButton({ id, label, selected, onClick }: { id: ChatAgentId; label: string; selected: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      title={label}
      data-onboarding-agent={id}
      className={cn(
        'flex min-w-0 items-center gap-2.5 rounded-lg border px-3 py-2.5 text-left transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
        selected ? 'border-foreground/60 bg-accent' : 'border-border hover:bg-accent/60'
      )}
      onClick={onClick}
    >
      <span className="grid size-7 shrink-0 place-items-center rounded-md bg-muted text-foreground">
        <TuiAgentIcon agent={id} size={16} />
      </span>
      <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{label}</span>
      {selected ? (
        <span className="grid size-4 shrink-0 place-items-center rounded-full bg-foreground text-background">
          <Check className="size-2.5" strokeWidth={3} />
        </span>
      ) : null}
    </button>
  )
}

/** Orca's AgentStep: agents detected on this computer first, the rest behind a disclosure. */
export function AgentStep() {
  const selected = useSetting('defaultChatAgent')
  const { kind, agents } = useChatAgents(LOCAL_HOST)
  const ready = agents.filter((a) => a.status === 'ready')
  const rest = CHAT_AGENT_IDS.filter((id) => !ready.some((a) => a.id === id))
  const [open, setOpen] = useState(() => rest.some((id) => id === selected))
  const selectedMissing = rest.find((id) => id === selected)
  const detail = (id: ChatAgentId) => agents.find((a) => a.id === id)?.detail
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5">
      {kind !== 'loading' && ready.length === 0 ? (
        <div className="shrink-0 rounded-lg border border-border px-4 py-3 text-xs text-muted-foreground">
          No chat agents found on this computer. Pick one to install later; Claude Code is the default.
        </div>
      ) : null}
      {selectedMissing ? (
        <div className="shrink-0 rounded-lg border border-status-warning-border px-4 py-2.5 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">{chatAgentLabel(selectedMissing)}</span> isn&apos;t ready on this computer yet
          {detail(selectedMissing) ? ` (${detail(selectedMissing)})` : ''}. It stays your default and starts once it is installed.
        </div>
      ) : null}
      <section className="flex min-h-0 flex-col gap-3 overflow-hidden">
        <SectionHeader label={ready.length ? 'Detected on your system' : 'Agents'} count={ready.length || undefined} />
        <div className="scrollbar-sleek min-h-0 space-y-3 overflow-y-auto pr-1">
          <div className="grid grid-cols-2 gap-2.5 md:grid-cols-3">
            {(ready.length ? ready.map((a) => a.id) : (['claude'] as ChatAgentId[])).map((id) => (
              <AgentButton key={id} id={id} label={chatAgentLabel(id)} selected={selected === id} onClick={() => setSetting('defaultChatAgent', id)} />
            ))}
          </div>
          {rest.length > (ready.length ? 0 : 1) ? (
            <Collapsible open={open} onOpenChange={setOpen}>
              <CollapsibleTrigger className="cursor-pointer text-xs font-medium text-muted-foreground transition-colors outline-none hover:text-foreground data-[state=open]:mb-3">
                {open ? 'Hide agents' : `Show ${rest.length - (ready.length ? 0 : 1)} more agents →`}
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="grid grid-cols-2 gap-2.5 md:grid-cols-3">
                  {rest
                    .filter((id) => ready.length || id !== 'claude')
                    .map((id) => (
                      <AgentButton key={id} id={id} label={chatAgentLabel(id)} selected={selected === id} onClick={() => setSetting('defaultChatAgent', id)} />
                    ))}
                </div>
              </CollapsibleContent>
            </Collapsible>
          ) : null}
        </div>
      </section>
    </div>
  )
}

const THEMES: { id: ThemePreference; label: string; hint: string; icon: typeof Monitor }[] = [
  { id: 'system', label: 'System', hint: 'Match OS', icon: Monitor },
  { id: 'dark', label: 'Dark', hint: 'Easy on the eyes', icon: Moon },
  { id: 'light', label: 'Light', hint: 'Bright & crisp', icon: Sun }
]

/** Orca's ThemeStep (without its macOS-only Ghostty import). */
export function ThemeStep() {
  const theme = useSetting('theme')
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-3 gap-3">
        {THEMES.map(({ id, label, hint, icon: Icon }) => {
          const selected = theme === id
          return (
            <button
              key={id}
              type="button"
              data-onboarding-theme={id}
              className={cn('group overflow-hidden rounded-xl border p-3 text-left transition-colors', selected ? 'border-foreground/60 bg-accent' : 'border-border hover:bg-accent/60')}
              onClick={() => setSetting('theme', id)}
            >
              <div className="relative mb-3 h-24 overflow-hidden rounded-lg border border-border">
                <ChromePreview variant={id} />
                {selected ? (
                  <div className="absolute top-1.5 right-1.5 grid size-5 place-items-center rounded-full bg-foreground text-background shadow-sm">
                    <Check className="size-3" strokeWidth={3} />
                  </div>
                ) : null}
              </div>
              <div className="flex items-baseline justify-between gap-2">
                <div className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                  <Icon className="size-3.5 text-muted-foreground" />
                  {label}
                </div>
                <div className="text-[11px] text-muted-foreground">{hint}</div>
              </div>
            </button>
          )
        })}
      </div>
      <div className="flex items-center gap-2 px-1 text-[12px] text-muted-foreground">
        <Settings2 className="size-3.5" />
        <span>
          More options, including fonts and the terminal cursor, in <span className="font-medium text-foreground">Settings → Appearance</span>
        </span>
      </div>
    </div>
  )
}

/** Stands in for Orca's Windows terminal step: WSL distros run their own daemon once connected. */
export function WslStep() {
  const [distros, setDistros] = useState<string[] | null>(null)
  const hosts = useStore((s) => s.hosts)
  useEffect(() => {
    if (!isTauri()) return setDistros([])
    void invoke<string[]>('wsl_distros').then(setDistros, () => setDistros([]))
  }, [])
  if (distros === null) return <p className="text-sm text-muted-foreground">Looking for WSL distros…</p>
  if (distros.length === 0) {
    return (
      <div className="rounded-lg border border-border px-4 py-3 text-sm text-muted-foreground" data-onboarding-wsl-empty>
        No WSL distros found. You can connect one later from <span className="font-medium text-foreground">+ › Connect WSL</span> in the sidebar.
      </div>
    )
  }
  return (
    <div className="space-y-2" data-onboarding-wsl>
      {distros.map((distro) => {
        const hostId = `wsl:${distro}`
        const state = hosts[hostId]?.connection.kind
        return (
          <div key={distro} className="flex items-center gap-3 rounded-lg border border-border px-4 py-3">
            <Server className="size-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate text-sm font-medium">{distro}</span>
            {state === 'connected' ? (
              <span className="inline-flex items-center gap-1 text-xs text-status-success">
                <Check className="size-3.5" />
                Connected
              </span>
            ) : (
              <Button variant="outline" size="sm" disabled={state === 'connecting'} onClick={() => void connectHost(hostId)}>
                {state === 'connecting' ? 'Connecting…' : 'Connect'}
              </Button>
            )}
          </div>
        )
      })}
      <p className="px-1 pt-1 text-xs text-muted-foreground">Projects inside a distro then open on that distro, with its own tools and agents.</p>
    </div>
  )
}

function ToggleRow({ label, description, checked, disabled, onChange }: { label: string; description: string; checked: boolean; disabled?: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-6 py-3">
      <span className="min-w-0 space-y-0.5">
        <span className="block text-sm font-medium text-foreground">{label}</span>
        <span className="block text-xs text-muted-foreground">{description}</span>
      </span>
      <Switch checked={checked} disabled={disabled} onCheckedChange={onChange} />
    </label>
  )
}

/** Orca's NotificationStep: which agent events notify, plus a test notification. */
export function NotificationStep() {
  const enabled = useSetting('notificationsEnabled')
  const finished = useSetting('notifyAgentFinished')
  const needsYou = useSetting('notifyAgentNeedsYou')
  const [test, setTest] = useState<'idle' | 'sent' | 'denied'>('idle')
  const sendTest = async () => {
    if (!isTauri()) return setTest('denied')
    const granted = (await isPermissionGranted()) || (await requestPermission()) === 'granted'
    if (granted) sendNotification({ title: 'ACP Harness', body: 'Notifications are on.' })
    setTest(granted ? 'sent' : 'denied')
  }
  return (
    <div className="space-y-4">
      <div className="divide-y divide-border/50 rounded-lg border border-border px-4">
        <ToggleRow label="Enable notifications" description="Desktop notifications from agents on every host." checked={enabled} onChange={(v) => setSetting('notificationsEnabled', v)} />
        <ToggleRow label="Agent finished" description="When a turn completes or stops with an error." checked={finished} disabled={!enabled} onChange={(v) => setSetting('notifyAgentFinished', v)} />
        <ToggleRow label="Agent needs you" description="When an agent asks for permission or input." checked={needsYou} disabled={!enabled} onChange={(v) => setSetting('notifyAgentNeedsYou', v)} />
      </div>
      <div className="flex items-center gap-3">
        <Button variant="outline" size="sm" disabled={!enabled} onClick={() => void sendTest()}>
          <Bell className="size-3.5" />
          Send a test notification
        </Button>
        {test === 'sent' ? <span className="text-xs text-muted-foreground">Sent — check your notification area.</span> : null}
        {test === 'denied' ? <span className="text-xs text-muted-foreground">Notifications are blocked for this app in your system settings.</span> : null}
      </div>
    </div>
  )
}

/** Orca ends on "Add your first project"; the harness also offers its Orca import here. */
export function ProjectStep({ onAddFolder, onImportOrca }: { onAddFolder: () => void; onImportOrca: () => void }) {
  const cards = [
    { key: 'folder', icon: FolderPlus, title: 'Add a project folder', body: 'A git repository or any folder on this computer.', onClick: onAddFolder },
    { key: 'orca', icon: Download, title: 'Import from Orca', body: "Bring over Orca's projects, on the host each lives on.", onClick: onImportOrca }
  ]
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {cards.map(({ key, icon: Icon, title, body, onClick }) => (
        <button
          key={key}
          type="button"
          data-onboarding-project={key}
          className="flex items-start gap-3 rounded-xl border border-border p-4 text-left transition-colors hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          onClick={onClick}
        >
          <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted text-foreground">
            <Icon className="size-4" />
          </span>
          <span className="min-w-0 space-y-1">
            <span className="block text-sm font-medium text-foreground">{title}</span>
            <span className="block text-xs leading-5 text-muted-foreground">{body}</span>
          </span>
        </button>
      ))}
    </div>
  )
}
