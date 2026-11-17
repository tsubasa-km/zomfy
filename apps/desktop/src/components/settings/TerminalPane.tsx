import { LOCAL_HOST, useStore } from '@/session-store'
import { setSetting, useSetting, type TerminalRightClick, type TerminalShortcutPolicy } from '@/stores/settings-store'
import { useHostSettings, updateHostSettings } from '@/stores/host-settings-store'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { SettingsRow, SettingsSegmentedControl, SettingsSubsectionHeader } from './settings-form-controls'
import { t } from '@/i18n/i18n'

// Orca's DESKTOP_TERMINAL_SCROLLBACK_ROW_PRESETS.
const SCROLLBACK_PRESETS = [5_000, 10_000, 25_000, 50_000]
const FIRST_SHELL = '__first'

/** The host's shell for new terminal tabs, stored by that host's daemon. */
export function DefaultShellRow({ hostId }: { hostId: string }) {
  const shells = useStore((s) => s.hosts[hostId]?.shells ?? [])
  const settings = useHostSettings(hostId)
  return (
    <SettingsRow
      label={t('Default shell')}
      description={t('New terminal tabs on this host start with it; the + menu can still pick another.')}
      keywords={['shell', 'powershell', 'bash', 'zsh', 'cmd']}
      control={
        <Select
          disabled={!settings || shells.length === 0}
          value={settings?.defaultShellId ?? FIRST_SHELL}
          onValueChange={(value) => void updateHostSettings(hostId, { defaultShellId: value === FIRST_SHELL ? null : value })}
        >
          <SelectTrigger size="sm" className="min-w-[200px]" aria-label={t('Default shell')}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={FIRST_SHELL}>{shells[0] ? t('First detected ({shell})', { shell: shells[0].label }) : t('First detected')}</SelectItem>
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
  const rightClick = useSetting('terminalRightClick')

  return (
    <div className="space-y-8">
      <div className="space-y-2 not-has-[[data-setting-row]]:hidden">
        <SettingsSubsectionHeader title={t('Behavior')} />
        <div className="divide-y divide-border/40">
          <SettingsRow
            label={t('Scrollback')}
            description={t('Lines each terminal keeps above the screen.')}
            keywords={['history', 'lines', 'buffer']}
            control={
              <Select value={String(scrollback)} onValueChange={(value) => setSetting('terminalScrollbackRows', Number(value))}>
                <SelectTrigger size="sm" className="min-w-[140px]" aria-label={t('Scrollback')}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SCROLLBACK_PRESETS.map((rows) => (
                    <SelectItem key={rows} value={String(rows)}>
                      {t('{n} lines', { n: rows.toLocaleString() })}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            }
          />
          <SettingsRow
            label={t('Right-click')}
            description={
              rightClick === 'copy-paste'
                ? t('Copies the selection, or pastes when nothing is selected, as in Windows Terminal. Shift+right-click, Shift+F10 or the … button at the top right of a terminal opens the menu.')
                : t('Opens the terminal menu. Shift+right-click copies the selection, or pastes when nothing is selected.')
            }
            keywords={['right click', 'context menu', 'copy', 'paste', 'mouse', 'windows terminal']}
            control={
              <SettingsSegmentedControl<TerminalRightClick>
                ariaLabel={t('Right-click')}
                value={rightClick}
                onChange={(value) => setSetting('terminalRightClick', value)}
                options={[
                  { value: 'menu', label: t('Show menu') },
                  { value: 'copy-paste', label: t('Copy / paste') }
                ]}
              />
            }
          />
          <SettingsRow
            label={t('Shortcuts in Terminal')}
            description={t('Choose whether the app or the focused terminal wins when shortcuts overlap.')}
            keywords={['shortcut', 'priority', 'policy', 'keybindings']}
            control={
              <SettingsSegmentedControl<TerminalShortcutPolicy>
                ariaLabel={t('Shortcuts in Terminal')}
                value={policy}
                onChange={(value) => setSetting('terminalShortcutPolicy', value)}
                options={[
                  { value: 'orca-first', label: t('App first') },
                  { value: 'terminal-first', label: t('Terminal first') }
                ]}
              />
            }
          />
        </div>
      </div>
      <div className="space-y-2 not-has-[[data-setting-row]]:hidden">
        <SettingsSubsectionHeader title={t('This computer')} description={t('Shells for other hosts are under Hosts.')} />
        <DefaultShellRow hostId={LOCAL_HOST} />
      </div>
    </div>
  )
}
