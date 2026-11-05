import { invoke } from '@tauri-apps/api/core'
import type { ChatImage } from '@/session-store'

// Files dropped on a chat composer from the OS arrive as paths (Tauri owns OS drags); images are
// read here and attached like pasted ones, other files go in as their paths.

const IMAGE_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp'
}

export function imageTypeOf(path: string): string | null {
  return IMAGE_TYPES[path.split('.').at(-1)?.toLowerCase() ?? ''] ?? null
}

function base64(bytes: ArrayBuffer): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const url = typeof reader.result === 'string' ? reader.result : ''
      resolve(url.slice(url.indexOf(',') + 1))
    }
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the image'))
    reader.readAsDataURL(new Blob([bytes]))
  })
}

/** The image at `path` on this computer, ready to send with a prompt. */
export async function readDroppedImage(path: string): Promise<ChatImage> {
  const mimeType = imageTypeOf(path)
  if (!mimeType) throw new Error(`${path} is not an image the chat can attach`)
  const bytes = await invoke<ArrayBuffer>('read_dropped_image', { path })
  return { mimeType, data: await base64(bytes) }
}
