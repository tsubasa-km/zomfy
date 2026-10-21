/** How a listener was tied to a workspace: started from one of its terminals, or running in its folder. */
export type PortAttribution = 'terminal' | 'cwd'

export interface ListeningPort {
  /** Stable per listener: `${pid}:${bindHost}:${port}`. */
  id: string
  port: number
  /** Address the OS reports; may be a wildcard bind. */
  bindHost: string
  /** Address to open or copy; wildcard binds become localhost. */
  connectHost: string
  pid: number | null
  processName: string | null
  workspaceId: string | null
  attribution: PortAttribution | null
}

export interface PortScanResult {
  platform: string
  scannedAt: number
  ports: ListeningPort[]
  unavailableReason?: string
}

export const PORT_METHODS = {
  portsList: '_harness/ports/list',
  portsKill: '_harness/ports/kill'
} as const

export interface PortRequests {
  /** `workspaceId` routes the request to that workspace's host; every listener on the host is returned. */
  [PORT_METHODS.portsList]: { params: { workspaceId: string }; result: PortScanResult }
  /** Only processes attributed to a workspace can be stopped. */
  [PORT_METHODS.portsKill]: { params: { workspaceId: string; pid: number; port: number }; result: Record<string, never> }
}
