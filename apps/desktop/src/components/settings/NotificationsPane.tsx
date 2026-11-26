import { setSetting, useSetting } from '@/stores/settings-store'
import { SettingsSwitchRow } from './settings-form-controls'
import { t } from '@/i18n/i18n'

export function NotificationsPane() {
  const enabled = useSetting('notificationsEnabled')
  const finished = useSetting('notifyAgentFinished')
  const needsYou = useSetting('notifyAgentNeedsYou')
  const suppress = useSetting('notifySuppressWhenFocused')
  const helpers = useSetting('notifyHelperThreads')

  return (
    <div className="divide-y divide-border/40">
      <SettingsSwitchRow
        label={t('Enable notifications')}
        description={t('Desktop notifications from agents on every host.')}
        keywords={['notify', 'desktop', 'alert']}
        checked={enabled}
        onChange={(checked) => setSetting('notificationsEnabled', checked)}
      />
      <SettingsSwitchRow
        label={t('Agent finished')}
        description={t('When a turn completes or stops with an error.')}
        keywords={['done', 'complete', 'turn']}
        checked={finished}
        disabled={!enabled}
        onChange={(checked) => setSetting('notifyAgentFinished', checked)}
      />
      <SettingsSwitchRow
        label={t('Agent needs you')}
        description={t('When an agent asks for permission or input.')}
        keywords={['permission', 'approval', 'attention']}
        checked={needsYou}
        disabled={!enabled}
        onChange={(checked) => setSetting('notifyAgentNeedsYou', checked)}
      />
      <SettingsSwitchRow
        label={t('Helper threads')}
        description={t('Notify and mark unread when a thread another thread started finishes. Off, you hear from the thread that started it, and only a helper that needs you notifies.')}
        keywords={['helper', 'child', 'worker', 'split']}
        checked={helpers}
        disabled={!enabled}
        onChange={(checked) => setSetting('notifyHelperThreads', checked)}
      />
      <SettingsSwitchRow
        label={t('Suppress while focused')}
        description={t('Skip the notification when that session is already on screen.')}
        keywords={['focus', 'quiet']}
        checked={suppress}
        disabled={!enabled}
        onChange={(checked) => setSetting('notifySuppressWhenFocused', checked)}
      />
    </div>
  )
}
