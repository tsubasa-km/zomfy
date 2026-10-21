import { Minus, Plus, RotateCcw } from 'lucide-react'
import { DEFAULT_SETTINGS, setSetting, useSetting, type TerminalCursorStyle, type ThemePreference } from '@/stores/settings-store'
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

// Orca's Appearance pane: Interface (theme, zoom, IDE font) and Terminal typography.

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
