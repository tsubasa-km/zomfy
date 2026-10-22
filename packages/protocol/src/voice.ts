// Composer dictation (Orca's cloud transcription path). The desktop records; this computer's daemon
// posts the audio to the OpenAI-compatible endpoint the user configured, so the app's own CSP stays
// closed to outside hosts.

export const VOICE_METHODS = {
  voiceTranscribe: '_harness/voice/transcribe'
} as const

export interface VoiceRequests {
  [VOICE_METHODS.voiceTranscribe]: {
    params: { endpoint: string; apiKey?: string; model: string; language?: string; audioBase64: string; mimeType: string }
    result: { text: string }
  }
}
