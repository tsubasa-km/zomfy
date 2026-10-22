import { createPointerDragChannel } from '@/lib/pointer-drag'
import { CHAT_COMPOSER_DROP_SELECTOR, chatComposerDropTarget } from '@/lib/chat-composer-drop'

/** Workspace-relative paths dragged from the file explorer: moved by explorer folders, typed by terminals. */
export interface DraggedPaths {
  workspaceId: string
  paths: string[]
}

export const filePathDrag = createPointerDragChannel<DraggedPaths>([
  {
    selector: CHAT_COMPOSER_DROP_SELECTOR,
    target: chatComposerDropTarget<DraggedPaths>('harness:file-drop', ({ workspaceId, paths }) =>
      paths.map((path) => ({ workspaceId, path }))
    )
  }
])
