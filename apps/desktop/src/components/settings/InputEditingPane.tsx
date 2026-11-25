import { DEFAULT_SETTINGS, setSetting, useSetting, type ChatAfterSend, type ChatSendKey, type ChatThinkingDisplay } from '@/stores/settings-store'
import { isMac } from '@/lib/terminal-shortcuts'
import { useStore } from '@/session-store'
import { sortedHosts } from './HostsPane'
import { LanguageServerSettings } from './LanguageServerSettings'
import {
  NumberField,
  SettingsRow,
  SettingsSegmentedControl,
  SettingsSubsectionHeader,
  SettingsSwitchRow,
  TextField
} from './settings-form-controls'
import { t } from '@/i18n/i18n'

export function InputEditingPane() {
  const fontFamily = useSetting('editorFontFamily')
  const fontSize = useSetting('editorFontSize')
  const wordWrap = useSetting('editorWordWrap')
  const minimap = useSetting('editorMinimap')
  const sendKey = useSetting('chatSendKey')
  const memos = useSetting('chatMemosEnabled')
  const afterSend = useSetting('chatAfterSend')
  const thinking = useSetting('chatThinkingDisplay')
  const hosts = useStore((s) => s.hosts)

  return (
    <div className="space-y-6">
      <div className="space-y-2 not-has-[[data-setting-row]]:hidden">
        <SettingsSubsectionHeader title={t('Thread')} description={t('The markdown composer under every thread.')} />
        <div className="divide-y divide-border/40">
          <SettingsRow
            label={t('Send message with')}
            description={t('The other key inserts a newline, like Shift+Enter.')}
            keywords={['chat', 'composer', 'enter', 'ctrl', 'cmd', 'send', 'newline']}
            control={
              <SettingsSegmentedControl<ChatSendKey>
                ariaLabel={t('Send message with')}
                value={sendKey}
                onChange={(value) => setSetting('chatSendKey', value)}
                options={[
                  { value: 'mod-enter', label: isMac ? '⌘ Enter' : 'Ctrl+Enter' },
                  { value: 'enter', label: 'Enter' }
                ]}
              />
            }
          />
          <SettingsRow
            label={t('After sending')}
            description={
              afterSend === 'new-chat'
                ? t("The thread's tab closes and New Thread opens, ready for the next task. The thread keeps running in the sidebar; the notice after sending opens it.")
                : t('The thread stays open, so you can watch the reply.')
            }
            keywords={['chat', 'send', 'new chat', 'close tab', 'background', 'after sending']}
            control={
              <SettingsSegmentedControl<ChatAfterSend>
                ariaLabel={t('After sending')}
                value={afterSend}
                onChange={(value) => setSetting('chatAfterSend', value)}
                options={[
                  { value: 'stay', label: t('Stay in the thread') },
                  { value: 'new-chat', label: t('Go to New Thread') }
                ]}
              />
            }
          />
          <SettingsRow
            label={t('Show thinking')}
            description={
              thinking === 'short-reply'
                ? t("Thinking starts open when the reply after it is short and the thinking is long, since it likely holds the answer.")
                : thinking === 'expanded'
                  ? t('Every thinking block starts open.')
                  : t('Every thinking block starts closed.')
            }
            keywords={['chat', 'thinking', 'reasoning', 'thought', 'expand', 'collapse']}
            control={
              <SettingsSegmentedControl<ChatThinkingDisplay>
                ariaLabel={t('Show thinking')}
                value={thinking}
                onChange={(value) => setSetting('chatThinkingDisplay', value)}
                options={[
                  { value: 'collapsed', label: t('Collapsed') },
                  { value: 'short-reply', label: t('Expand when the reply is short') },
                  { value: 'expanded', label: t('Always expanded') }
                ]}
              />
            }
          />
          <SettingsSwitchRow
            label={t('Experimental: thread memos')}
            description={t("A markdown memo beside each thread's composer, saved on the thread's host.")}
            keywords={['chat', 'memo', 'notes', 'markdown', 'experimental']}
            checked={memos}
            onChange={(checked) => setSetting('chatMemosEnabled', checked)}
          />
        </div>
      </div>
      <div className="space-y-2 not-has-[[data-setting-row]]:hidden">
        <SettingsSubsectionHeader title={t('Editor')} description={t('File previews and diffs opened from the right sidebar.')} />
        <div className="divide-y divide-border/40">
          <TextField
            label={t('Editor Font')}
            description={t('Empty follows the terminal font.')}
            keywords={['editor', 'font', 'monaco']}
            value={fontFamily}
            placeholder={t('Terminal font')}
            onChange={(value) => setSetting('editorFontFamily', value)}
          />
          <NumberField
            label={t('Editor Font Size')}
            keywords={['editor', 'font size']}
            value={fontSize}
            defaultValue={DEFAULT_SETTINGS.editorFontSize}
            min={8}
            max={32}
            suffix="px"
            onChange={(value) => setSetting('editorFontSize', value)}
          />
          <SettingsSwitchRow
            label={t('Word Wrap')}
            keywords={['editor', 'wrap']}
            checked={wordWrap}
            onChange={(checked) => setSetting('editorWordWrap', checked)}
          />
          <SettingsSwitchRow
            label={t('Minimap')}
            keywords={['editor', 'minimap', 'overview']}
            checked={minimap}
            onChange={(checked) => setSetting('editorMinimap', checked)}
          />
        </div>
      </div>
      <div className="space-y-2 not-has-[[data-setting-row]]:hidden">
        <SettingsSubsectionHeader
          title={t('Language servers')}
          description={t('Completion, diagnostics and navigation come from language servers on the host where the files are. Zomfy starts the ones it finds there and installs none.')}
        />
        {sortedHosts(hosts)
          .filter((host) => host.connection.kind === 'connected')
          .map((host) => (
            <LanguageServerSettings key={host.id} host={host} />
          ))}
      </div>
    </div>
  )
}
