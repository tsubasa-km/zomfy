import { useEffect, useRef, useState } from 'react'
import { Loader2, Mic, Square } from 'lucide-react'
import { HARNESS_METHODS } from '@acp-harness/protocol'
import { harnessRequest } from '@/daemon-connection'
import { LOCAL_HOST } from '@/session-store'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useSettings } from '@/stores/settings-store'
import { t } from '@/i18n/i18n'

// Orca's composer dictation (components/dictation/), with Orca's cloud path only: audio goes to the
// OpenAI-compatible transcription endpoint the user configured in Settings › Voice, never elsewhere.
// Orca's offline models need a native speech runtime the harness does not ship.

type Phase = { kind: 'idle' } | { kind: 'recording'; startedAt: number } | { kind: 'transcribing' } | { kind: 'error'; message: string }

export function NativeChatDictationButton({ onTranscript }: { onTranscript: (text: string) => void }) {
  const config = useSettings((s) =>
    s.voiceDictationEnabled && s.dictationEndpoint.trim()
      ? `${s.dictationEndpoint}\u0000${s.dictationModel}\u0000${s.dictationApiKey}\u0000${s.dictationLanguage}`
      : null
  )
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' })
  const [, tick] = useState(0)
  const recorder = useRef<MediaRecorder | null>(null)

  useEffect(() => {
    if (phase.kind !== 'recording') return
    const timer = setInterval(() => tick((n) => n + 1), 500)
    return () => clearInterval(timer)
  }, [phase.kind])
  // Releases the microphone if the composer goes away mid-recording.
  useEffect(() => () => recorder.current?.stream.getTracks().forEach((t) => t.stop()), [])

  if (!config) return null
  const [endpoint, model, apiKey, language] = config.split('\u0000') as [string, string, string, string]

  const start = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const chunks: Blob[] = []
      const rec = new MediaRecorder(stream)
      rec.ondataavailable = (e) => e.data.size > 0 && chunks.push(e.data)
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop())
        recorder.current = null
        void transcribe(new Blob(chunks, { type: rec.mimeType || 'audio/webm' }))
      }
      recorder.current = rec
      rec.start()
      setPhase({ kind: 'recording', startedAt: Date.now() })
    } catch (e) {
      setPhase({ kind: 'error', message: e instanceof Error ? e.message : t('Microphone unavailable') })
    }
  }

  const transcribe = async (audio: Blob) => {
    if (audio.size === 0) return setPhase({ kind: 'idle' })
    setPhase({ kind: 'transcribing' })
    try {
      const bytes = new Uint8Array(await audio.arrayBuffer())
      let binary = ''
      for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
      // This computer's daemon makes the upload, so the app's CSP never opens to outside hosts.
      const { text } = await harnessRequest(
        HARNESS_METHODS.voiceTranscribe,
        { endpoint, model, mimeType: audio.type, audioBase64: btoa(binary), ...(apiKey ? { apiKey } : {}), ...(language.trim() ? { language: language.trim() } : {}) },
        LOCAL_HOST
      )
      if (text) onTranscript(text)
      setPhase({ kind: 'idle' })
    } catch (e) {
      setPhase({ kind: 'error', message: e instanceof Error ? e.message : String(e) })
    }
  }

  const recording = phase.kind === 'recording'
  const seconds = recording ? Math.floor((Date.now() - phase.startedAt) / 1000) : 0
  const label =
    phase.kind === 'recording'
      ? t('Stop dictation ({seconds}s)', { seconds })
      : phase.kind === 'transcribing'
        ? t('Transcribing…')
        : phase.kind === 'error'
          ? t('Dictation: {message}', { message: phase.message })
          : t('Dictate')
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={label}
          aria-pressed={recording}
          data-dictation={phase.kind}
          className={recording ? 'size-8 rounded-full text-destructive' : 'size-8 rounded-full text-muted-foreground'}
          disabled={phase.kind === 'transcribing'}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => (recording ? recorder.current?.stop() : void start())}
        >
          {phase.kind === 'transcribing' ? (
            <Loader2 className="size-4 animate-spin" />
          ) : recording ? (
            <Square className="size-3.5 animate-pulse fill-current" />
          ) : (
            <Mic className="size-4" />
          )}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top">{label}</TooltipContent>
    </Tooltip>
  )
}
