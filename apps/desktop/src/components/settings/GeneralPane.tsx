import { useState } from 'react'
import { Download, RefreshCw, RotateCcw, Sparkles, Compass } from 'lucide-react'
import { setSidebarView, useStore, type SidebarView } from '@/session-store'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { sortedHosts } from './HostsPane'
import { resetAllSettings, setSetting, useSetting, type AppSettings } from '@/stores/settings-store'
import { t } from '@/i18n/i18n'
import { setOnboardingOpen } from '@/stores/app-overlay-store'
import { Button } from '@/components/ui/button'
import { startTour } from '@/components/tour/GuidedTour'
import { checkForUpdate, restartToUpdate, useAppUpdate, type UpdateState } from '@/lib/app-update'
import { SettingsRow, SettingsSegmentedControl, SettingsSubsectionHeader, SettingsSwitchRow } from './settings-form-controls'

/** Where New chat and Add a project start; 'auto' follows the host with most of the projects. */
function DefaultHostSelect() {
  const value = useSetting('defaultHost')
  const hosts = sortedHosts(useStore((s) => s.hosts))
  return (
    <Select value={value} onValueChange={(v) => setSetting('defaultHost', v)}>
      <SelectTrigger className="h-8 w-56" aria-label={t('Default host')}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="auto">{t('Automatic (where most projects are)')}</SelectItem>
        {hosts.map((h) => (
          <SelectItem key={h.id} value={h.id}>
            {h.label}
          </SelectItem>
        ))}
        {value !== 'auto' && !hosts.some((h) => h.id === value) && <SelectItem value={value}>{value}</SelectItem>}
      </SelectContent>
    </Select>
  )
}

function updateStatus(u: UpdateState): string {
  const version = u.current ? t('Zomfy {version}. ', { version: u.current }) : ''
  switch (u.phase) {
    case 'checking':
      return `${version}${t('Checking…')}`
    case 'downloading':
      return `${version}${t('Downloading {version}…', { version: u.next })}`
    case 'ready':
      return `${version}${t('{version} is ready; restart to update.', { version: u.next })}`
    case 'current':
      return `${version}${t('This is the latest version.')}`
    case 'error':
      return `${version}${t("Couldn't check: {error}", { error: u.error })}`
    case 'unavailable':
      return `${version}${t('Only the installed app updates; this one runs from source.')}`
    default:
      return `${version}${t('Zomfy checks for updates on start and every few hours.')}`
  }
}

function UpdateRow() {
  const update = useAppUpdate((u) => u)
  const busy = update.phase === 'checking' || update.phase === 'downloading'
  return (
    <SettingsRow
      label={t('Updates')}
      description={updateStatus(update)}
      keywords={['update', 'version', 'upgrade', 'release']}
      control={
        update.phase === 'ready' ? (
          <Button size="sm" onClick={restartToUpdate} data-update-restart>
            <Download className="size-3.5" />
            {t('Restart to update')}
          </Button>
        ) : (
          <Button variant="outline" size="sm" disabled={busy} onClick={() => void checkForUpdate(true)} data-update-check>
            <RefreshCw className="size-3.5" />
            {t('Check now')}
          </Button>
        )
      }
    />
  )
}

export function GeneralPane() {
  const view = useStore((s) => s.sidebarView)
  const statusBarVisible = useSetting('statusBarVisible')
  const minimizeToTray = useSetting('minimizeToTrayOnClose')
  const language = useSetting('language')
  const [confirmReset, setConfirmReset] = useState(false)

  return (
    <div className="space-y-8">
      <div className="space-y-2 not-has-[[data-setting-row]]:hidden">
        <SettingsSubsectionHeader title={t('Workspaces')} description={t("How the sidebar lists workspaces; the sidebar's own options menu changes the same values.")} />
        <div className="divide-y divide-border/40">
          <SettingsRow
            label={t('Default host')}
            description={t('Where New chat and Add a project start when you do not pick a host.')}
            keywords={['host', 'wsl', 'ssh', 'default', 'machine']}
            control={<DefaultHostSelect />}
          />
          <SettingsRow
            label={t('Group workspaces by')}
            keywords={['sidebar', 'project', 'status']}
            control={
              <SettingsSegmentedControl<SidebarView['groupBy']>
                ariaLabel={t('Group workspaces by')}
                value={view.groupBy}
                onChange={(groupBy) => setSidebarView({ groupBy })}
                options={[
                  { value: 'project', label: t('Project') },
                  { value: 'status', label: t('Status') }
                ]}
              />
            }
          />
          <SettingsRow
            label={t('Sort workspaces by')}
            keywords={['sidebar', 'name', 'recent', 'created']}
            control={
              <SettingsSegmentedControl<SidebarView['sortBy']>
                ariaLabel={t('Sort workspaces by')}
                value={view.sortBy}
                onChange={(sortBy) => setSidebarView({ sortBy })}
                options={[
                  { value: 'created', label: t('Created') },
                  { value: 'name', label: t('Name') },
                  { value: 'recent', label: t('Recent') },
                  { value: 'manual', label: t('Manual') }
                ]}
              />
            }
          />
        </div>
      </div>

      <div className="space-y-2 not-has-[[data-setting-row]]:hidden">
        <SettingsSubsectionHeader title={t('Window')} />
        <div className="divide-y divide-border/40">
          <SettingsRow
            label={t('Language')}
            description={t('The language Zomfy is shown in. The window reloads to switch.')}
            keywords={['language', 'japanese', 'english', 'locale', '言語', '日本語']}
            control={
              <SettingsSegmentedControl<AppSettings['language']>
                ariaLabel={t('Language')}
                value={language}
                onChange={(next) => {
                  setSetting('language', next)
                  location.reload()
                }}
                options={[
                  { value: 'system', label: t('Same as the system') },
                  { value: 'en', label: 'English' },
                  { value: 'ja', label: '日本語' }
                ]}
              />
            }
          />
          <SettingsSwitchRow
            label={t('Status bar')}
            description={t('Hosts, branch and agent activity along the bottom of the window. Right-click it to choose segments.')}
            keywords={['footer', 'status bar']}
            checked={statusBarVisible}
            onChange={(checked) => setSetting('statusBarVisible', checked)}
          />
          {navigator.userAgent.includes('Windows') ? (
            <SettingsSwitchRow
              label={t('Minimize to Tray on Close')}
              description={t('When enabled, closing the window keeps Zomfy and its daemons running in the system tray instead of quitting.')}
              keywords={['tray', 'minimize', 'close', 'background']}
              checked={minimizeToTray}
              onChange={(checked) => setSetting('minimizeToTrayOnClose', checked)}
            />
          ) : null}
        </div>
      </div>

      <div className="space-y-2 not-has-[[data-setting-row]]:hidden">
        <SettingsSubsectionHeader title={t('Maintenance')} />
        <UpdateRow />
        <SettingsRow
          label={t('Run setup again')}
          description={t('Reopens the first-run guide: default agent, theme, WSL, notifications and your first project.')}
          keywords={['onboarding', 'welcome', 'first run', 'setup']}
          control={
            <Button variant="outline" size="sm" onClick={() => setOnboardingOpen(true)} data-run-setup>
              <Sparkles className="size-3.5" />
              {t('Open')}
            </Button>
          }
        />
        <SettingsRow
          label={t('Take the tour')}
          description={t('Walks through the window: chats, layout, workflows, and the pages that keep track of your agents.')}
          keywords={['tour', 'tutorial', 'guide', 'help', 'walkthrough']}
          control={
            <Button variant="outline" size="sm" onClick={startTour} data-take-tour>
              <Compass className="size-3.5" />
              {t('Start')}
            </Button>
          }
        />
        <SettingsRow
          label={t('Reset all settings')}
          description={t('Restores every preference and shortcut in this window to its default. Host settings are kept.')}
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
              {confirmReset ? t('Click again to reset') : t('Reset')}
            </Button>
          }
        />
      </div>
    </div>
  )
}
