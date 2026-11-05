import Lightbox from 'yet-another-react-lightbox'
import Captions from 'yet-another-react-lightbox/plugins/captions'
import Counter from 'yet-another-react-lightbox/plugins/counter'
import Zoom from 'yet-another-react-lightbox/plugins/zoom'
import 'yet-another-react-lightbox/styles.css'
import 'yet-another-react-lightbox/plugins/captions.css'
import 'yet-another-react-lightbox/plugins/counter.css'
import { createExternalStore } from '@/stores/external-store'
import type { ChatImage } from '@/session-store'

// The chat's one image viewer (yet-another-react-lightbox): a thumbnail or an image path opens it
// over the window, with zoom (wheel, pinch, double-click), panning and, for several, arrows
// between them. Mounted once per window; anything opens it through openChatLightbox.

export interface LightboxImage {
  src: string
  /** Shown under the image: its path, when it came from one. */
  title?: string
}

const store = createExternalStore<{ images: LightboxImage[]; index: number } | null>(null)

export function openChatLightbox(images: LightboxImage[], index = 0): void {
  if (images.length > 0) store.set({ images, index: Math.min(Math.max(0, index), images.length - 1) })
}

export function chatImageSrc(image: ChatImage): string {
  return `data:${image.mimeType};base64,${image.data}`
}

export function ChatLightbox() {
  const shown = store.use((s) => s)
  return (
    <Lightbox
      open={shown !== null}
      close={() => store.set(null)}
      index={shown?.index ?? 0}
      slides={shown?.images ?? []}
      // A counter says nothing for one image.
      plugins={(shown?.images.length ?? 0) > 1 ? [Zoom, Counter, Captions] : [Zoom, Captions]}
      zoom={{ maxZoomPixelRatio: 4, scrollToZoom: true }}
      counter={{ container: { style: { top: 'unset', bottom: 0 } } }}
      // One image has nowhere to go: no arrows, no wrapping.
      carousel={{ finite: (shown?.images.length ?? 0) <= 1 }}
      render={(shown?.images.length ?? 0) <= 1 ? { buttonPrev: () => null, buttonNext: () => null } : undefined}
      controller={{ closeOnBackdropClick: true }}
    />
  )
}
