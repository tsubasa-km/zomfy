import { setSetting, useSetting } from '@/stores/settings-store'
import { SettingsSwitchRow } from './settings-form-controls'

export function NotificationsPane() {
  const enabled = useSetting('notificationsEnabled')
  const finished = useSetting('notifyAgentFinished')
  const needsYou = useSetting('notifyAgentNeedsYou')
  const suppress = useSetting('notifySuppressWhenFocused')

  return (
    <div className="divide-y divide-border/40">
      <SettingsSwitchRow
        label="Enable notifications"
        description="Desktop notifications from agents on every host."
        keywords={['notify', 'desktop', 'alert']}
        checked={enabled}
        onChange={(checked) => setSetting('notificationsEnabled', checked)}
      />
      <SettingsSwitchRow
        label="Agent finished"
        description="When a turn completes or stops with an error."
        keywords={['done', 'complete', 'turn']}
        checked={finished}
        disabled={!enabled}
        onChange={(checked) => setSetting('notifyAgentFinished', checked)}
      />
      <SettingsSwitchRow
        label="Agent needs you"
        description="When an agent asks for permission or input."
        keywords={['permission', 'approval', 'attention']}
        checked={needsYou}
        disabled={!enabled}
        onChange={(checked) => setSetting('notifyAgentNeedsYou', checked)}
      />
      <SettingsSwitchRow
        label="Suppress while focused"
        description="Skip the notification when that session is already on screen."
        keywords={['focus', 'quiet']}
        checked={suppress}
        disabled={!enabled}
        onChange={(checked) => setSetting('notifySuppressWhenFocused', checked)}
      />
    </div>
  )
}
