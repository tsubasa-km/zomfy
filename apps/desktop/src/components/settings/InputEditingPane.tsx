import { DEFAULT_SETTINGS, setSetting, useSetting } from '@/stores/settings-store'
import { NumberField, SettingsSubsectionHeader, SettingsSwitchRow, TextField } from './settings-form-controls'

export function InputEditingPane() {
  const fontFamily = useSetting('editorFontFamily')
  const fontSize = useSetting('editorFontSize')
  const wordWrap = useSetting('editorWordWrap')
  const minimap = useSetting('editorMinimap')

  return (
    <div className="space-y-2 not-has-[[data-setting-row]]:hidden">
      <SettingsSubsectionHeader title="Editor" description="File previews and diffs opened from the right sidebar." />
      <div className="divide-y divide-border/40">
        <TextField
          label="Editor Font"
          description="Empty follows the terminal font."
          keywords={['editor', 'font', 'monaco']}
          value={fontFamily}
          placeholder="Terminal font"
          onChange={(value) => setSetting('editorFontFamily', value)}
        />
        <NumberField
          label="Editor Font Size"
          keywords={['editor', 'font size']}
          value={fontSize}
          defaultValue={DEFAULT_SETTINGS.editorFontSize}
          min={8}
          max={32}
          suffix="px"
          onChange={(value) => setSetting('editorFontSize', value)}
        />
        <SettingsSwitchRow
          label="Word Wrap"
          keywords={['editor', 'wrap']}
          checked={wordWrap}
          onChange={(checked) => setSetting('editorWordWrap', checked)}
        />
        <SettingsSwitchRow
          label="Minimap"
          keywords={['editor', 'minimap', 'overview']}
          checked={minimap}
          onChange={(checked) => setSetting('editorMinimap', checked)}
        />
      </div>
    </div>
  )
}
