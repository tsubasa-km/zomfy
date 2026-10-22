import { getState, LOCAL_HOST, type HostId } from '@/session-store'
import { getSetting } from '@/stores/settings-store'
import { sortedHosts } from '@/components/settings/HostsPane'

/**
 * Where new chats and projects start unless the person picks a host: the Default host setting
 * when that host is connected, else ("auto") the connected host holding most of their projects.
 */
export function defaultHostId(): HostId {
  const { hosts } = getState()
  const connected = (id: HostId) => hosts[id]?.connection.kind === 'connected'
  const setting = getSetting('defaultHost')
  if (setting !== 'auto' && connected(setting)) return setting
  let best: HostId = LOCAL_HOST
  let most = -1
  // Ties go to the earlier host in sidebar order, this computer first.
  for (const host of sortedHosts(hosts)) {
    if (!connected(host.id)) continue
    const count = host.harness?.projects.length ?? 0
    if (count > most) {
      best = host.id
      most = count
    }
  }
  return best
}
