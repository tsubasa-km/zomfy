import { DEFAULT_SETTINGS, setSetting, useSetting, type ChatSendKey } from '@/stores/settings-store'
import { isMac } from '@/lib/terminal-shortcuts'
import {
  NumberField,
  SettingsRow,
  SettingsSegmentedControl,
  SettingsSubsectionHeader,
  SettingsSwitchRow,
  TextField
} from './settings-form-controls'

export function InputEditingPane() {
  const fontFamily = useSetting('editorFontFamily')
  const fontSize = useSetting('editorFontSize')
  const wordWrap = useSetting('editorWordWrap')
  const minimap = useSetting('editorMinimap')
  const sendKey = useSetting('chatSendKey')
  const memos = useSetting('chatMemosEnabled')

  return (
    <div className="space-y-6">
      <div className="space-y-2 not-has-[[data-setting-row]]:hidden">
        <SettingsSubsectionHeader title="Chat" description="The markdown composer under every chat." />
        <div className="divide-y divide-border/40">
          <SettingsRow
            label="Send message with"
            description="The other key inserts a newline, like Shift+Enter."
            keywords={['chat', 'composer', 'enter', 'ctrl', 'cmd', 'send', 'newline']}
            control={
              <SettingsSegmentedControl<ChatSendKey>
                ariaLabel="Send message with"
                value={sendKey}
                onChange={(value) => setSetting('chatSendKey', value)}
                options={[
                  { value: 'mod-enter', label: isMac ? '⌘ Enter' : 'Ctrl+Enter' },
                  { value: 'enter', label: 'Enter' }
                ]}
              />
            }
          />
          <SettingsSwitchRow
            label="Experimental: chat memos"
            description="A markdown memo beside each chat's composer, saved on the chat's host."
            keywords={['chat', 'memo', 'notes', 'markdown', 'experimental']}
            checked={memos}
            onChange={(checked) => setSetting('chatMemosEnabled', checked)}
          />
        </div>
      </div>
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
    </div>
  )
}
