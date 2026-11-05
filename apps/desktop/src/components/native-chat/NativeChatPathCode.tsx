import { useState } from 'react'
import { isTauri } from '@tauri-apps/api/core'
import { HARNESS_METHODS } from '@acp-harness/protocol'
import { harnessRequest } from '@/daemon-connection'
import { LOCAL_HOST, findWorkspace, openEditorTab } from '@/session-store'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { readDroppedImage } from '@/lib/chat-file-drop'
import { openHref } from '@/lib/link-routing'
import { isImagePath, workspaceRelativePath } from '@/lib/link-targets'
import { t } from '@/i18n/i18n'

// A path an agent wrote as inline code (`out/flow.png`) opens from the chat: an image shows right
// here, read through the workspace's host, or from this computer when it lies outside the workspace;
// any other file opens in an editor tab, as a path link does.

type Shown = { path: string; workspaceId: string | null; src: string | null; error: string | null }

function joinPath(root: string, relative: string): string {
  const sep = root.includes('\\') ? '\\' : '/'
  return `${root.replace(/[\\/]+$/, '')}${sep}${relative.replaceAll(/[\\/]/g, sep)}`
}

async function imageSource(path: string, workspaceId: string | null): Promise<string> {
  const workspace = workspaceId ? findWorkspace(workspaceId) : null
  const relative = workspace ? workspaceRelativePath(path, workspace.path) : null
  const extension = path.split('.').at(-1)!.toLowerCase()
  const mime = extension === 'jpg' ? 'image/jpeg' : `image/${extension}`
  if (workspace && relative !== null) {
    const content = await harnessRequest(HARNESS_METHODS.fsReadBinary, { workspaceId: workspace.id, path: relative }, workspace.hostId)
    return `data:${mime};base64,${content.base64}`
  }
  // Outside the workspace (a temp folder, say), only this computer's own files can be read.
  if (isTauri() && (!workspace || workspace.hostId === LOCAL_HOST)) {
    const absolute = workspace && !/^([A-Za-z]:[\\/]|[\\/])/.test(path) ? joinPath(workspace.path, path) : path
    const image = await readDroppedImage(absolute)
    return `data:${image.mimeType};base64,${image.data}`
  }
  throw new Error(t('Only images in the workspace, or on this computer, can be shown here.'))
}

export function NativeChatPathCode({ path }: { path: string }) {
  const [shown, setShown] = useState<Shown | null>(null)
  const image = isImagePath(path)

  const open = (event: React.MouseEvent<HTMLElement>) => {
    event.preventDefault()
    const workspaceId = event.currentTarget.closest<HTMLElement>('[data-link-workspace-id]')?.dataset.linkWorkspaceId ?? null
    if (!image) return openHref(path, { inApp: false, workspaceId })
    setShown({ path, workspaceId, src: null, error: null })
    imageSource(path, workspaceId).then(
      (src) => setShown((s) => (s?.path === path ? { ...s, src } : s)),
      (error: unknown) => setShown((s) => (s?.path === path ? { ...s, error: error instanceof Error ? error.message : String(error) } : s))
    )
  }

  const relative = shown?.workspaceId ? workspaceRelativePath(path, findWorkspace(shown.workspaceId)?.path ?? null) : null
  return (
    <>
      <code
        role="link"
        tabIndex={0}
        data-chat-path={path}
        title={image ? t('Show this image') : t('Open this file')}
        onClick={open}
        onKeyDown={(event) => {
          if (event.key === 'Enter') open(event as unknown as React.MouseEvent<HTMLElement>)
        }}
        className="cursor-pointer rounded bg-accent px-1.5 py-0.5 font-mono text-[0.92em] underline decoration-dotted underline-offset-2 [overflow-wrap:anywhere] hover:decoration-solid"
      >
        {path}
      </code>
      {image ? (
        <Dialog open={shown !== null} onOpenChange={(o) => !o && setShown(null)}>
          <DialogContent className="flex max-h-[90vh] max-w-[90vw] flex-col sm:max-w-[90vw]" data-chat-image-preview>
            <DialogHeader>
              <DialogTitle className="text-sm">{t('Image')}</DialogTitle>
              <DialogDescription className="font-mono text-xs break-all">{path}</DialogDescription>
            </DialogHeader>
            <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto">
              {shown?.error ? (
                <p className="text-sm text-destructive">{shown.error}</p>
              ) : shown?.src ? (
                <img src={shown.src} alt={path} className="max-h-[70vh] max-w-full object-contain" />
              ) : (
                <p className="text-sm text-muted-foreground">{t('Loading…')}</p>
              )}
            </div>
            {shown?.workspaceId && relative !== null ? (
              <div className="flex justify-end">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    openEditorTab({ workspaceId: shown.workspaceId!, kind: 'file', path: relative, staged: false })
                    setShown(null)
                  }}
                >
                  {t('Open as tab')}
                </Button>
              </div>
            ) : null}
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  )
}
