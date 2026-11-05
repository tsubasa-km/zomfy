import { useEffect, useRef, useState } from 'react'
import { isTauri } from '@tauri-apps/api/core'
import { HARNESS_METHODS } from '@acp-harness/protocol'
import { harnessRequest } from '@/daemon-connection'
import { LOCAL_HOST, findWorkspace, type ChatImage } from '@/session-store'
import { readDroppedImage } from '@/lib/chat-file-drop'
import { openHref } from '@/lib/link-routing'
import { isImagePath, looksLikeFilePath, workspaceRelativePath } from '@/lib/link-targets'
import { toast } from 'sonner'
import { ToolImages } from './NativeChatToolLine'
import { chatImageSrc, openChatLightbox } from './ChatLightbox'
import { t } from '@/i18n/i18n'

// A path an agent wrote as inline code (`out/flow.png`) opens from the chat: an image in the chat's
// viewer, any other file like a path link. An image path also shows the image under the message, as
// the images tools return do. Images are read through the workspace's host, or from this computer
// when they lie outside the workspace.

function joinPath(root: string, relative: string): string {
  const sep = root.includes('\\') ? '\\' : '/'
  return `${root.replace(/[\\/]+$/, '')}${sep}${relative.replaceAll(/[\\/]/g, sep)}`
}

function imageError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function readPathImage(path: string, workspaceId: string | null): Promise<ChatImage> {
  const workspace = workspaceId ? findWorkspace(workspaceId) : null
  const relative = workspace ? workspaceRelativePath(path, workspace.path) : null
  const extension = path.split('.').at(-1)!.toLowerCase()
  const mimeType = extension === 'jpg' ? 'image/jpeg' : `image/${extension}`
  if (workspace && relative !== null) {
    const content = await harnessRequest(HARNESS_METHODS.fsReadBinary, { workspaceId: workspace.id, path: relative }, workspace.hostId)
    return { mimeType, data: content.base64 }
  }
  // Outside the workspace (a temp folder, say), only this computer's own files can be read.
  if (isTauri() && (!workspace || workspace.hostId === LOCAL_HOST)) {
    const absolute = workspace && !/^([A-Za-z]:[\\/]|[\\/])/.test(path) ? joinPath(workspace.path, path) : path
    return readDroppedImage(absolute)
  }
  throw new Error(t('Only images in the workspace, or on this computer, can be shown here.'))
}

// Read once per window: a message re-rendered (a growing reply, windowing) shows them again at once.
const images = new Map<string, Promise<ChatImage>>()

function pathImage(path: string, workspaceId: string | null): Promise<ChatImage> {
  const key = `${workspaceId ?? ''}\n${path}`
  let found = images.get(key)
  if (!found) {
    found = readPathImage(path, workspaceId)
    // A failure is not kept: the file may appear once the agent writes it.
    found.catch(() => images.delete(key))
    images.set(key, found)
  }
  return found
}

/** Image paths a message names in inline code, each once, in order. */
export function imagePathsIn(markdown: string): string[] {
  const found = new Set<string>()
  // Inline code outside fenced blocks: a fence's content is code, not a reference.
  const text = markdown.replace(/```[\s\S]*?(```|$)/g, '')
  for (const match of text.matchAll(/`([^`\n]+)`/g)) {
    const path = match[1]!.trim()
    if (looksLikeFilePath(path) && isImagePath(path)) found.add(path.replace(/(?::\d+){1,2}$/, ''))
  }
  return [...found]
}

/** The images a message's paths point at, under it; the chat's workspace is read from the page. */
export function NativeChatPathImages({ paths }: { paths: string[] }) {
  const ref = useRef<HTMLDivElement>(null)
  const [loaded, setLoaded] = useState<{ image: ChatImage; path: string }[]>([])
  const key = paths.join('\n')
  useEffect(() => {
    let cancelled = false
    const workspaceId = ref.current?.closest<HTMLElement>('[data-link-workspace-id]')?.dataset.linkWorkspaceId ?? null
    // One that cannot be read is simply not shown; its path stays a link.
    const reads = paths.map((path) => pathImage(path, workspaceId).then((image) => ({ image, path }), () => null))
    void Promise.all(reads).then((list) => {
      if (!cancelled) setLoaded(list.filter((i) => i !== null))
    })
    return () => {
      cancelled = true
    }
    // Keyed on the paths' text: callers pass a fresh array each render.
  }, [key])
  return (
    <div ref={ref}>
      {loaded.length > 0 ? <ToolImages images={loaded.map((l) => l.image)} titles={loaded.map((l) => l.path)} className="ml-0" /> : null}
    </div>
  )
}

/** A path in inline code: an image opens in the chat's viewer, any other file like a path link. */
export function NativeChatPathCode({ path }: { path: string }) {
  const image = isImagePath(path)
  const open = (event: React.SyntheticEvent<HTMLElement>) => {
    event.preventDefault()
    const workspaceId = event.currentTarget.closest<HTMLElement>('[data-link-workspace-id]')?.dataset.linkWorkspaceId ?? null
    if (!image) return openHref(path, { inApp: false, workspaceId })
    pathImage(path, workspaceId).then(
      (loaded) => openChatLightbox([{ src: chatImageSrc(loaded), title: path }]),
      (error: unknown) => toast.error(t('Could not show {path}: {error}', { path, error: imageError(error) }))
    )
  }
  return (
    <code
      role="link"
      tabIndex={0}
      data-chat-path={path}
      title={image ? t('Show this image') : t('Open this file')}
      onClick={open}
      onKeyDown={(event) => event.key === 'Enter' && open(event)}
      className="cursor-pointer rounded bg-accent px-1.5 py-0.5 font-mono text-[0.92em] underline decoration-dotted underline-offset-2 [overflow-wrap:anywhere] hover:decoration-solid"
    >
      {path}
    </code>
  )
}
