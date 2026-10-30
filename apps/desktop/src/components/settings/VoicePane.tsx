import { setSetting, useSetting } from '@/stores/settings-store'
import { SettingsSwitchRow, TextField } from './settings-form-controls'
import { t } from '@/i18n/i18n'

// Orca's Voice settings, cloud option only: an OpenAI-compatible transcription endpoint of the
// user's choosing (OpenAI, or a local Whisper server). Nothing is sent until one is set.

export function VoicePane() {
  const enabled = useSetting('voiceDictationEnabled')
  const endpoint = useSetting('dictationEndpoint')
  const model = useSetting('dictationModel')
  const apiKey = useSetting('dictationApiKey')
  const language = useSetting('dictationLanguage')
  return (
    <div className="divide-y divide-border/40">
      <SettingsSwitchRow
        label={t('Dictation')}
        description={t('Adds a microphone button to the chat composer. Recordings go only to the endpoint below.')}
        keywords={['voice', 'speech', 'microphone', 'dictate', 'whisper']}
        checked={enabled}
        onChange={(checked) => setSetting('voiceDictationEnabled', checked)}
      />
      <TextField
        label={t('Transcription endpoint')}
        description={t('OpenAI-compatible base URL; /audio/transcriptions is appended. The button stays hidden until this is set.')}
        keywords={['voice', 'whisper', 'url', 'openai', 'endpoint']}
        value={endpoint}
        placeholder="https://api.openai.com/v1"
        className="w-72 font-mono text-xs"
        onChange={(value) => setSetting('dictationEndpoint', value)}
      />
      <TextField
        label={t('Model')}
        keywords={['voice', 'whisper', 'model']}
        value={model}
        placeholder="whisper-1"
        className="w-72 font-mono text-xs"
        onChange={(value) => setSetting('dictationModel', value || 'whisper-1')}
      />
      <TextField
        label={t('API key')}
        description={t("Sent as a bearer token to the endpoint above; kept in this window's local storage.")}
        keywords={['voice', 'key', 'token', 'openai']}
        type="password"
        value={apiKey}
        placeholder={t('Optional for local servers')}
        className="w-72 font-mono text-xs"
        onChange={(value) => setSetting('dictationApiKey', value)}
      />
      <TextField
        label={t('Language')}
        description={t('ISO code such as en or ja; empty lets the service detect it.')}
        keywords={['voice', 'language', 'locale']}
        value={language}
        placeholder="auto"
        className="w-72 font-mono text-xs"
        onChange={(value) => setSetting('dictationLanguage', value)}
      />
    </div>
  )
}
