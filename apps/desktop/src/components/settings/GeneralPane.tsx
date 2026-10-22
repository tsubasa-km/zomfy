import { useState } from 'react'
import { RotateCcw, Sparkles } from 'lucide-react'
import { setSidebarView, useStore, type SidebarView } from '@/session-store'
import { resetAllSettings, setSetting, useSetting } from '@/stores/settings-store'
import { setOnboardingOpen } from '@/stores/app-overlay-store'
import { Button } from '@/components/ui/button'
import { SettingsRow, SettingsSegmentedControl, SettingsSubsectionHeader, SettingsSwitchRow } from './settings-form-controls'

export function GeneralPane() {
  const view = useStore((s) => s.sidebarView)
  const statusBarVisible = useSetting('statusBarVisible')
  const minimizeToTray = useSetting('minimizeToTrayOnClose')
  const [confirmReset, setConfirmReset] = useState(false)

  return (
    <div className="space-y-8">
      <div className="space-y-2 not-has-[[data-setting-row]]:hidden">
        <SettingsSubsectionHeader title="Workspaces" description="How the sidebar lists workspaces; the sidebar's own options menu changes the same values." />
        <div className="divide-y divide-border/40">
          <SettingsRow
            label="Group workspaces by"
            keywords={['sidebar', 'project', 'status']}
            control={
              <SettingsSegmentedControl<SidebarView['groupBy']>
                ariaLabel="Group workspaces by"
                value={view.groupBy}
                onChange={(groupBy) => setSidebarView({ groupBy })}
                options={[
                  { value: 'project', label: 'Project' },
                  { value: 'status', label: 'Status' }
                ]}
              />
            }
          />
          <SettingsRow
            label="Sort workspaces by"
            keywords={['sidebar', 'name', 'recent', 'created']}
            control={
              <SettingsSegmentedControl<SidebarView['sortBy']>
                ariaLabel="Sort workspaces by"
                value={view.sortBy}
                onChange={(sortBy) => setSidebarView({ sortBy })}
                options={[
                  { value: 'created', label: 'Created' },
                  { value: 'name', label: 'Name' },
                  { value: 'recent', label: 'Recent' },
                  { value: 'manual', label: 'Manual' }
                ]}
              />
            }
          />
        </div>
      </div>

      <div className="space-y-2 not-has-[[data-setting-row]]:hidden">
        <SettingsSubsectionHeader title="Window" />
        <div className="divide-y divide-border/40">
          <SettingsSwitchRow
            label="Status bar"
            description="Hosts, branch and agent activity along the bottom of the window. Right-click it to choose segments."
            keywords={['footer', 'status bar']}
            checked={statusBarVisible}
            onChange={(checked) => setSetting('statusBarVisible', checked)}
          />
          {navigator.userAgent.includes('Windows') ? (
            <SettingsSwitchRow
              label="Minimize to Tray on Close"
              description="When enabled, closing the window keeps Zomfy and its daemons running in the system tray instead of quitting."
              keywords={['tray', 'minimize', 'close', 'background']}
              checked={minimizeToTray}
              onChange={(checked) => setSetting('minimizeToTrayOnClose', checked)}
            />
          ) : null}
        </div>
      </div>

      <div className="space-y-2 not-has-[[data-setting-row]]:hidden">
        <SettingsSubsectionHeader title="Maintenance" />
        <SettingsRow
          label="Run setup again"
          description="Reopens the first-run guide: default agent, theme, WSL, notifications and your first project."
          keywords={['onboarding', 'welcome', 'first run', 'setup']}
          control={
            <Button variant="outline" size="sm" onClick={() => setOnboardingOpen(true)} data-run-setup>
              <Sparkles className="size-3.5" />
              Open
            </Button>
          }
        />
        <SettingsRow
          label="Reset all settings"
          description="Restores every preference and shortcut in this window to its default. Host settings are kept."
          keywords={['defaults', 'restore']}
          control={
            <Button
              variant={confirmReset ? 'destructive' : 'outline'}
              size="sm"
              onBlur={() => setConfirmReset(false)}
              onClick={() => {
                if (!confirmReset) {
                  setConfirmReset(true)
                  return
                }
                resetAllSettings()
                setConfirmReset(false)
              }}
            >
              <RotateCcw className="size-3.5" />
              {confirmReset ? 'Click again to reset' : 'Reset'}
            </Button>
          }
        />
      </div>
    </div>
  )
}
