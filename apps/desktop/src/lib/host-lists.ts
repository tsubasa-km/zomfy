import type { Project, Workspace } from '@acp-harness/protocol'

// Every host's projects and workspaces as one list, built once per `hosts` object: a store selector
// that picks one of these must get the same object back while nothing changed, or
// useSyncExternalStore sees a new snapshot on every read and React re-renders until it gives up
// (error #185), blanking the window. Callers must not mutate the lists.

type Hosted<T> = T & { hostId: string }
interface HostLike {
  id: string
  harness?: { projects?: Project[]; workspaces?: Workspace[]; floatingWorkspaceId?: string | null } | null
}

const projectLists = new WeakMap<object, Hosted<Project>[]>()
const workspaceLists = new WeakMap<object, Hosted<Workspace>[]>()

export function hostedProjects(hosts: Record<string, HostLike>): Hosted<Project>[] {
  let list = projectLists.get(hosts)
  if (!list) {
    list = Object.values(hosts).flatMap((h) => h.harness?.projects?.map((p) => ({ ...p, hostId: h.id })) ?? [])
    projectLists.set(hosts, list)
  }
  return list
}

/** The floating workspace of a host other than `localHost` is left out: only this computer's is used. */
export function hostedWorkspaces(hosts: Record<string, HostLike>, localHost: string): Hosted<Workspace>[] {
  let list = workspaceLists.get(hosts)
  if (!list) {
    list = Object.values(hosts).flatMap(
      (h) =>
        h.harness?.workspaces
          ?.filter((w) => h.id === localHost || w.id !== h.harness?.floatingWorkspaceId)
          .map((w) => ({ ...w, hostId: h.id })) ?? []
    )
    workspaceLists.set(hosts, list)
  }
  return list
}
