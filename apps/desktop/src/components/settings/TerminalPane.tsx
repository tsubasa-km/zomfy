import { LOCAL_HOST, useStore } from '@/session-store'
import { setSetting, useSetting, type TerminalShortcutPolicy } from '@/stores/settings-store'
import { useHostSettings, updateHostSettings } from '@/stores/host-settings-store'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { SettingsRow, SettingsSegmentedControl, SettingsSubsectionHeader } from './settings-form-controls'

// Orca's DESKTOP_TERMINAL_SCROLLBACK_ROW_PRESETS.
const SCROLLBACK_PRESETS = [5_000, 10_000, 25_000, 50_000]
const FIRST_SHELL = '__first'

/** The host's shell for new terminal tabs, stored by that host's daemon. */
export function DefaultShellRow({ hostId }: { hostId: string }) {
  const shells = useStore((s) => s.hosts[hostId]?.shells ?? [])
  const settings = useHostSettings(hostId)
  return (
    <SettingsRow
      label="Default shell"
      description="New terminal tabs on this host start with it; the + menu can still pick another."
      keywords={['shell', 'powershell', 'bash', 'zsh', 'cmd']}
      control={
        <Select
          disabled={!settings || shells.length === 0}
          value={settings?.defaultShellId ?? FIRST_SHELL}
          onValueChange={(value) => void updateHostSettings(hostId, { defaultShellId: value === FIRST_SHELL ? null : value })}
        >
          <SelectTrigger size="sm" className="min-w-[200px]" aria-label="Default shell">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={FIRST_SHELL}>First detected{shells[0] ? ` (${shells[0].label})` : ''}</SelectItem>
            {shells.map((shell) => (
              <SelectItem key={shell.id} value={shell.id}>
                {shell.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      }
    />
  )
}

export function TerminalPane() {
  const scrollback = useSetting('terminalScrollbackRows')
  const policy = useSetting('terminalShortcutPolicy')

  return (
    <div className="space-y-8">
      <div className="space-y-2 not-has-[[data-setting-row]]:hidden">
        <SettingsSubsectionHeader title="Behavior" />
        <div className="divide-y divide-border/40">
          <SettingsRow
            label="Scrollback"
            description="Lines each terminal keeps above the screen."
            keywords={['history', 'lines', 'buffer']}
            control={
              <Select value={String(scrollback)} onValueChange={(value) => setSetting('terminalScrollbackRows', Number(value))}>
                <SelectTrigger size="sm" className="min-w-[140px]" aria-label="Scrollback">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SCROLLBACK_PRESETS.map((rows) => (
                    <SelectItem key={rows} value={String(rows)}>
                      {rows.toLocaleString()} lines
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            }
          />
          <SettingsRow
            label="Shortcuts in Terminal"
            description="Choose whether the app or the focused terminal wins when shortcuts overlap."
            keywords={['shortcut', 'priority', 'policy', 'keybindings']}
            control={
              <SettingsSegmentedControl<TerminalShortcutPolicy>
                ariaLabel="Shortcuts in Terminal"
                value={policy}
                onChange={(value) => setSetting('terminalShortcutPolicy', value)}
                options={[
                  { value: 'orca-first', label: 'App first' },
                  { value: 'terminal-first', label: 'Terminal first' }
                ]}
              />
            }
          />
        </div>
      </div>
      <div className="space-y-2 not-has-[[data-setting-row]]:hidden">
        <SettingsSubsectionHeader title="This computer" description="Shells for other hosts are under Hosts." />
        <DefaultShellRow hostId={LOCAL_HOST} />
      </div>
    </div>
  )
}
