import { useEffect, useRef, useState } from 'react'
import { isTauri } from '@tauri-apps/api/core'
import { HARNESS_METHODS } from '@acp-harness/protocol'
import { harnessRequest } from '@/daemon-connection'
import { LOCAL_HOST, findWorkspace, type ChatImage } from '@/session-store'
import { readDroppedImage } from '@/lib/chat-file-drop'
import { openHref } from '@/lib/link-routing'
import { isImagePath, looksLikeFilePath, workspaceRelativePath } from '@/lib/link-targets'
import { ToolImages } from './NativeChatToolLine'
import { t } from '@/i18n/i18n'

// A path an agent wrote as inline code (`out/flow.png`) opens from the chat like a path link, and an
// image path also shows the image under the message, as the images tools return do: read through
// the workspace's host, or from this computer when it lies outside the workspace.

function joinPath(root: string, relative: string): string {
  const sep = root.includes('\\') ? '\\' : '/'
  return `${root.replace(/[\\/]+$/, '')}${sep}${relative.replaceAll(/[\\/]/g, sep)}`
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
  throw new Error('outside the workspace')
}

// Read once per window: a message re-rendered (a growing reply, windowing) shows them again at once.
const images = new Map<string, Promise<ChatImage | null>>()

function pathImage(path: string, workspaceId: string | null): Promise<ChatImage | null> {
  const key = `${workspaceId ?? ''}\n${path}`
  let found = images.get(key)
  if (!found) {
    // One that cannot be read is simply not shown; the path stays a link.
    found = readPathImage(path, workspaceId).catch(() => null)
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
  const [loaded, setLoaded] = useState<ChatImage[]>([])
  const key = paths.join('\n')
  useEffect(() => {
    let cancelled = false
    const workspaceId = ref.current?.closest<HTMLElement>('[data-link-workspace-id]')?.dataset.linkWorkspaceId ?? null
    void Promise.all(paths.map((p) => pathImage(p, workspaceId))).then((list) => {
      if (!cancelled) setLoaded(list.filter((i): i is ChatImage => i !== null))
    })
    return () => {
      cancelled = true
    }
    // Keyed on the paths' text: callers pass a fresh array each render.
  }, [key])
  return <div ref={ref}>{loaded.length > 0 ? <ToolImages images={loaded} className="ml-0" /> : null}</div>
}

/** A path in inline code: opens like a path link (an editor tab; an image shows in its viewer). */
export function NativeChatPathCode({ path }: { path: string }) {
  const open = (event: React.SyntheticEvent<HTMLElement>) => {
    event.preventDefault()
    const workspaceId = event.currentTarget.closest<HTMLElement>('[data-link-workspace-id]')?.dataset.linkWorkspaceId ?? null
    openHref(path, { inApp: false, workspaceId })
  }
  return (
    <code
      role="link"
      tabIndex={0}
      data-chat-path={path}
      title={t('Open this file')}
      onClick={open}
      onKeyDown={(event) => event.key === 'Enter' && open(event)}
      className="cursor-pointer rounded bg-accent px-1.5 py-0.5 font-mono text-[0.92em] underline decoration-dotted underline-offset-2 [overflow-wrap:anywhere] hover:decoration-solid"
    >
      {path}
    </code>
  )
}
