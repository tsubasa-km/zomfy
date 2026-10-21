export interface QuickOpenFileList {
  /** Workspace-relative, '/'-separated. */
  files: string[]
  /** The listing hit its cap; refine the query rather than trust absence. */
  truncated: boolean
}

export const QUICK_OPEN_METHODS = {
  quickOpenFiles: '_harness/quick-open/files'
} as const

export interface QuickOpenRequests {
  [QUICK_OPEN_METHODS.quickOpenFiles]: { params: { workspaceId: string }; result: QuickOpenFileList }
}
