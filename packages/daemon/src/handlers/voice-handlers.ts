import { HARNESS_METHODS } from "@acp-harness/protocol";
import type { HandlerContext } from "./handler-context.ts";

const MAX_AUDIO_BYTES = 25 * 1024 * 1024; // OpenAI's upload limit.

function transcriptionUrl(endpoint: string): URL {
  const url = new URL(endpoint.trim().replace(/\/+$/, ""));
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("The transcription endpoint must be an http(s) URL");
  if (!url.pathname.endsWith("/audio/transcriptions")) url.pathname = `${url.pathname.replace(/\/+$/, "")}/audio/transcriptions`;
  return url;
}

/** Posts dictated audio to the endpoint the user configured; nothing else is ever called. */
export function registerVoiceHandlers({ handle }: HandlerContext): void {
  handle(HARNESS_METHODS.voiceTranscribe, async (p) => {
    const audio = Buffer.from(p.audioBase64, "base64");
    if (audio.length === 0) return { text: "" };
    if (audio.length > MAX_AUDIO_BYTES) throw new Error("Recording is too long to transcribe");
    const form = new FormData();
    form.append("file", new Blob([audio], { type: p.mimeType }), p.mimeType.includes("ogg") ? "dictation.ogg" : "dictation.webm");
    form.append("model", p.model || "whisper-1");
    if (p.language?.trim()) form.append("language", p.language.trim());
    const response = await fetch(transcriptionUrl(p.endpoint), {
      method: "POST",
      headers: p.apiKey ? { Authorization: `Bearer ${p.apiKey}` } : {},
      body: form,
      signal: AbortSignal.timeout(120_000),
    });
    if (!response.ok) throw new Error(`Transcription failed (${response.status}): ${(await response.text()).slice(0, 300)}`);
    const body: unknown = await response.json();
    const text = body && typeof body === "object" && typeof (body as { text?: unknown }).text === "string" ? (body as { text: string }).text : "";
    return { text: text.trim() };
  });
}
