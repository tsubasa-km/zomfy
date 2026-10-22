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

// Orca's Appearance pane: Interface (theme, zoom, IDE font), Sidebar rows, the floating workspace
// toggle (Orca's FloatingWorkspacePane) and Terminal typography.

function UIZoomControl() {
  const level = useSetting('uiZoomLevel')
  const apply = (next: number) => setSetting('uiZoomLevel', Math.max(UI_ZOOM_MIN, Math.min(UI_ZOOM_MAX, next)))
  return (
    <div className="flex items-center gap-2">
      <Button variant="outline" size="icon-sm" aria-label="Zoom out" onClick={() => apply(level - UI_ZOOM_STEP)} disabled={level <= UI_ZOOM_MIN}>
        <Minus className="size-3" />
      </Button>
      <span className="w-14 text-center text-sm text-foreground tabular-nums">{zoomPercent(level)}%</span>
      <Button variant="outline" size="icon-sm" aria-label="Zoom in" onClick={() => apply(level + UI_ZOOM_STEP)} disabled={level >= UI_ZOOM_MAX}>
        <Plus className="size-3" />
      </Button>
      <Button variant="outline" size="sm" onClick={() => apply(0)} disabled={level === 0} className="ml-1 gap-1.5">
        <RotateCcw className="size-3" />
        Reset
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
  const checklist = useSetting('setupGuideSidebarDismissed')
  return (
    <div className="space-y-2 not-has-[[data-setting-row]]:hidden">
      <SettingsSubsectionHeader title="Sidebar" description="Rows above the workspace list. Right-click a row to hide it." />
      <div className="divide-y divide-border/40">
        <SettingsSwitchRow
          label="Show New Chat Button"
          keywords={['new chat', 'quick chat', 'sidebar', 'button']}
          checked={newChat}
          onChange={(v) => setSetting('showNewChatButton', v)}
        />
        <SettingsSwitchRow label="Show Tasks Button" keywords={['tasks', 'sidebar', 'button', 'issues']} checked={tasks} onChange={(v) => setSetting('showTasksButton', v)} />
        <SettingsSwitchRow
          label="Show Automations Button"
          keywords={['automations', 'automation', 'schedule', 'sidebar']}
          checked={automations}
          onChange={(v) => setSetting('showAutomationsButton', v)}
        />
        <SettingsSwitchRow label="Show Skills Button" keywords={['skills', 'sidebar', 'button']} checked={skills} onChange={(v) => setSetting('showSkillsButton', v)} />
        <SettingsSwitchRow
          label="Show Agent Dashboard Button"
          keywords={['dashboard', 'agents', 'sidebar']}
          checked={dashboard}
          onChange={(v) => setSetting('showAgentDashboardButton', v)}
        />
        <SettingsSwitchRow
          label="Show Onboarding Checklist"
          description="Shown until setup is complete."
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
      <SettingsSubsectionHeader title="Floating Workspace" />
      <div className="divide-y divide-border/40">
        <SettingsSwitchRow
          label="Enable Floating Workspace"
          description="Shows the floating workspace button and panel."
          keywords={['floating', 'workspace', 'terminal', 'quick panel']}
          checked={enabled}
          onChange={(v) => setSetting('floatingWorkspaceEnabled', v)}
        />
        <SettingsRow
          label="Toggle Button Location"
          description="The keyboard shortcut works regardless of where the toggle is shown."
          keywords={['floating', 'status bar', 'button']}
          control={
            <SettingsSegmentedControl<FloatingWorkspaceTriggerLocation>
              ariaLabel="Toggle Button Location"
              value={location === 'status-bar' ? 'status-bar' : 'floating-button'}
              onChange={(value) => setSetting('floatingWorkspaceTriggerLocation', value)}
              options={[
                { value: 'floating-button', label: 'Floating Button' },
                { value: 'status-bar', label: 'Status Bar' }
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
        <SettingsSubsectionHeader title="Interface" />
        <div className="divide-y divide-border/40">
          <SettingsRow
            label="Theme"
            keywords={['dark', 'light', 'system', 'color']}
            control={
              <SettingsSegmentedControl<ThemePreference>
                ariaLabel="Theme"
                value={theme}
                onChange={(value) => setSetting('theme', value)}
                options={[
                  { value: 'system', label: 'System' },
                  { value: 'dark', label: 'Dark' },
                  { value: 'light', label: 'Light' }
                ]}
              />
            }
          />
          <SettingsRow
            label="UI Zoom"
            keywords={['zoom', 'scale', 'size']}
            description={zoomIn && zoomOut ? `${zoomIn} / ${zoomOut} from anywhere in the app.` : undefined}
            control={<UIZoomControl />}
          />
          <TextField
            label="IDE Font"
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
        <SettingsSubsectionHeader title="Terminal" description="Typography for terminal tabs on every host." />
        <div className="divide-y divide-border/40">
          <TextField
            label="Terminal Font"
            keywords={['font', 'terminal', 'monospace']}
            value={terminalFont}
            placeholder="Platform monospace"
            onChange={(value) => setSetting('terminalFontFamily', value)}
          />
          <NumberField
            label="Terminal Font Size"
            keywords={['font size', 'terminal']}
            value={terminalFontSize}
            defaultValue={DEFAULT_SETTINGS.terminalFontSize}
            min={8}
            max={32}
            suffix="px"
            onChange={(value) => setSetting('terminalFontSize', value)}
          />
          <NumberField
            label="Line Height"
            keywords={['terminal', 'spacing']}
            value={lineHeight}
            defaultValue={DEFAULT_SETTINGS.terminalLineHeight}
            min={0.8}
            max={2}
            step={0.05}
            onChange={(value) => setSetting('terminalLineHeight', value)}
          />
          <SettingsRow
            label="Cursor Style"
            keywords={['cursor', 'block', 'bar', 'underline']}
            control={
              <SettingsSegmentedControl<TerminalCursorStyle>
                ariaLabel="Cursor Style"
                value={cursorStyle}
                onChange={(value) => setSetting('terminalCursorStyle', value)}
                options={[
                  { value: 'block', label: 'Block' },
                  { value: 'bar', label: 'Bar' },
                  { value: 'underline', label: 'Underline' }
                ]}
              />
            }
          />
          <SettingsSwitchRow
            label="Blinking Cursor"
            keywords={['cursor', 'blink']}
            checked={cursorBlink}
            onChange={(checked) => setSetting('terminalCursorBlink', checked)}
          />
        </div>
      </div>
    </div>
  )
}
