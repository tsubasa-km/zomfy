import { Minus, Plus, RotateCcw } from 'lucide-react'
import {
  DEFAULT_SETTINGS,
  setSetting,
  useSetting,
  type FloatingWorkspaceTriggerLocation,
  type TerminalCursorStyle,
  type ThemePreference
} from '@/stores/settings-store'
import { UI_ZOOM_MAX, UI_ZOOM_MIN, UI_ZOOM_STEP, zoomPercent } from '@/lib/ui-zoom'
import { useShortcutLabel } from '@/keybindings/keybinding-registry'
import { Button } from '@/components/ui/button'
import {
  NumberField,
  SettingsRow,
  SettingsSegmentedControl,
  SettingsSubsectionHeader,
  SettingsSwitchRow,
  TextField
} from './settings-form-controls'
import { t } from '@/i18n/i18n'

// Orca's Appearance pane: Interface (theme, zoom, IDE font), Sidebar rows, the floating workspace
// toggle (Orca's FloatingWorkspacePane) and Terminal typography.

function UIZoomControl() {
  const level = useSetting('uiZoomLevel')
  const apply = (next: number) => setSetting('uiZoomLevel', Math.max(UI_ZOOM_MIN, Math.min(UI_ZOOM_MAX, next)))
  return (
    <div className="flex items-center gap-2">
      <Button variant="outline" size="icon-sm" aria-label={t('Zoom out')} onClick={() => apply(level - UI_ZOOM_STEP)} disabled={level <= UI_ZOOM_MIN}>
        <Minus className="size-3" />
      </Button>
      <span className="w-14 text-center text-sm text-foreground tabular-nums">{zoomPercent(level)}%</span>
      <Button variant="outline" size="icon-sm" aria-label={t('Zoom in')} onClick={() => apply(level + UI_ZOOM_STEP)} disabled={level >= UI_ZOOM_MAX}>
        <Plus className="size-3" />
      </Button>
      <Button variant="outline" size="sm" onClick={() => apply(0)} disabled={level === 0} className="ml-1 gap-1.5">
        <RotateCcw className="size-3" />
        {t('Reset')}
      </Button>
    </div>
  )
}

/** Orca's AppearanceWindowSidebarSection: which optional SidebarNav rows show. */
function SidebarSection() {
  const tasks = useSetting('showTasksButton')
  const newChat = useSetting('showNewChatButton')
  const automations = useSetting('showAutomationsButton')
  const skills = useSetting('showSkillsButton')
  const dashboard = useSetting('showAgentDashboardButton')
  const workflows = useSetting('showWorkflowsButton')
  const checklist = useSetting('setupGuideSidebarDismissed')
  return (
    <div className="space-y-2 not-has-[[data-setting-row]]:hidden">
      <SettingsSubsectionHeader title={t('Sidebar')} description={t('Rows above the workspace list. Right-click a row to hide it.')} />
      <div className="divide-y divide-border/40">
        <SettingsSwitchRow
          label={t('Show New Chat Button')}
          keywords={['new chat', 'quick chat', 'sidebar', 'button']}
          checked={newChat}
          onChange={(v) => setSetting('showNewChatButton', v)}
        />
        <SettingsSwitchRow label={t('Show Tasks Button')} keywords={['tasks', 'sidebar', 'button', 'issues']} checked={tasks} onChange={(v) => setSetting('showTasksButton', v)} />
        <SettingsSwitchRow
          label={t('Show Workflows Button')}
          keywords={['workflows', 'workflow', 'sidebar', 'button']}
          checked={workflows}
          onChange={(v) => setSetting('showWorkflowsButton', v)}
        />
        <SettingsSwitchRow
          label={t('Show Automations Button')}
          keywords={['automations', 'automation', 'schedule', 'sidebar']}
          checked={automations}
          onChange={(v) => setSetting('showAutomationsButton', v)}
        />
        <SettingsSwitchRow label={t('Show Skills Button')} keywords={['skills', 'sidebar', 'button']} checked={skills} onChange={(v) => setSetting('showSkillsButton', v)} />
        <SettingsSwitchRow
          label={t('Show Agent Dashboard Button')}
          keywords={['dashboard', 'agents', 'sidebar']}
          checked={dashboard}
          onChange={(v) => setSetting('showAgentDashboardButton', v)}
        />
        <SettingsSwitchRow
          label={t('Show Onboarding Checklist')}
          description={t('Shown until setup is complete.')}
          keywords={['onboarding', 'setup', 'checklist', 'sidebar']}
          checked={!checklist}
          onChange={(v) => setSetting('setupGuideSidebarDismissed', !v)}
        />
      </div>
    </div>
  )
}

/** Orca's FloatingWorkspacePane: the feature switch and where its toggle lives. */
function FloatingWorkspaceSection() {
  const enabled = useSetting('floatingWorkspaceEnabled')
  const location = useSetting('floatingWorkspaceTriggerLocation')
  return (
    <div className="space-y-2 not-has-[[data-setting-row]]:hidden">
      <SettingsSubsectionHeader title={t('Floating Workspace')} />
      <div className="divide-y divide-border/40">
        <SettingsSwitchRow
          label={t('Enable Floating Workspace')}
          description={t('Shows the floating workspace button and panel.')}
          keywords={['floating', 'workspace', 'terminal', 'quick panel']}
          checked={enabled}
          onChange={(v) => setSetting('floatingWorkspaceEnabled', v)}
        />
        <SettingsRow
          label={t('Toggle Button Location')}
          description={t('The keyboard shortcut works regardless of where the toggle is shown.')}
          keywords={['floating', 'status bar', 'button']}
          control={
            <SettingsSegmentedControl<FloatingWorkspaceTriggerLocation>
              ariaLabel={t('Toggle Button Location')}
              value={location === 'status-bar' ? 'status-bar' : 'floating-button'}
              onChange={(value) => setSetting('floatingWorkspaceTriggerLocation', value)}
              options={[
                { value: 'floating-button', label: t('Floating Button') },
                { value: 'status-bar', label: t('Status Bar') }
              ]}
            />
          }
        />
      </div>
    </div>
  )
}

export function AppearancePane() {
  const theme = useSetting('theme')
  const appFont = useSetting('appFontFamily')
  const terminalFont = useSetting('terminalFontFamily')
  const terminalFontSize = useSetting('terminalFontSize')
  const lineHeight = useSetting('terminalLineHeight')
  const cursorStyle = useSetting('terminalCursorStyle')
  const cursorBlink = useSetting('terminalCursorBlink')
  const zoomIn = useShortcutLabel('zoom.in')
  const zoomOut = useShortcutLabel('zoom.out')

  return (
    <div className="space-y-8">
      <div className="space-y-2 not-has-[[data-setting-row]]:hidden">
        <SettingsSubsectionHeader title={t('Interface')} />
        <div className="divide-y divide-border/40">
          <SettingsRow
            label={t('Theme')}
            keywords={['dark', 'light', 'system', 'color']}
            control={
              <SettingsSegmentedControl<ThemePreference>
                ariaLabel={t('Theme')}
                value={theme}
                onChange={(value) => setSetting('theme', value)}
                options={[
                  { value: 'system', label: t('System') },
                  { value: 'dark', label: t('Dark') },
                  { value: 'light', label: t('Light') }
                ]}
              />
            }
          />
          <SettingsRow
            label={t('UI Zoom')}
            keywords={['zoom', 'scale', 'size']}
            description={zoomIn && zoomOut ? t('{zoomIn} / {zoomOut} from anywhere in the app.', { zoomIn, zoomOut }) : undefined}
            control={<UIZoomControl />}
          />
          <TextField
            label={t('IDE Font')}
            keywords={['font', 'typeface', 'typography']}
            value={appFont}
            placeholder="Geist"
            onChange={(value) => setSetting('appFontFamily', value)}
          />
        </div>
      </div>

      <SidebarSection />

      <FloatingWorkspaceSection />

      <div className="space-y-2 not-has-[[data-setting-row]]:hidden">
        <SettingsSubsectionHeader title={t('Terminal')} description={t('Typography for terminal tabs on every host.')} />
        <div className="divide-y divide-border/40">
          <TextField
            label={t('Terminal Font')}
            keywords={['font', 'terminal', 'monospace']}
            value={terminalFont}
            placeholder={t('Platform monospace')}
            onChange={(value) => setSetting('terminalFontFamily', value)}
          />
          <NumberField
            label={t('Terminal Font Size')}
            keywords={['font size', 'terminal']}
            value={terminalFontSize}
            defaultValue={DEFAULT_SETTINGS.terminalFontSize}
            min={8}
            max={32}
            suffix="px"
            onChange={(value) => setSetting('terminalFontSize', value)}
          />
          <NumberField
            label={t('Line Height')}
            keywords={['terminal', 'spacing']}
            value={lineHeight}
            defaultValue={DEFAULT_SETTINGS.terminalLineHeight}
            min={0.8}
            max={2}
            step={0.05}
            onChange={(value) => setSetting('terminalLineHeight', value)}
          />
          <SettingsRow
            label={t('Cursor Style')}
            keywords={['cursor', 'block', 'bar', 'underline']}
            control={
              <SettingsSegmentedControl<TerminalCursorStyle>
                ariaLabel={t('Cursor Style')}
                value={cursorStyle}
                onChange={(value) => setSetting('terminalCursorStyle', value)}
                options={[
                  { value: 'block', label: t('Block') },
                  { value: 'bar', label: t('Bar') },
                  { value: 'underline', label: t('Underline') }
                ]}
              />
            }
          />
          <SettingsSwitchRow
            label={t('Blinking Cursor')}
            keywords={['cursor', 'blink']}
            checked={cursorBlink}
            onChange={(checked) => setSetting('terminalCursorBlink', checked)}
          />
        </div>
      </div>
    </div>
  )
}
