import { HARNESS_METHODS, type ProjectLink, type ProjectMemberRef } from '@acp-harness/protocol'
import { harnessRequest } from '@/daemon-connection'
import { LOCAL_HOST } from '@/session-store'
import { createExternalStore } from './external-store'

// Which host projects form one project (protocol project-links.ts), kept on this computer's daemon.

const store = createExternalStore<ProjectLink[]>([])

export function setProjectLinks(links: ProjectLink[]): void {
  store.set(links)
}

export function getProjectLinks(): ProjectLink[] {
  return store.get()
}

export function useProjectLinks(): ProjectLink[] {
  return store.use((links) => links)
}

const sameMember = (a: ProjectMemberRef, b: ProjectMemberRef) => a.hostId === b.hostId && a.projectId === b.projectId

export function linkOf(member: ProjectMemberRef): ProjectLink | null {
  return store.get().find((l) => l.members.some((m) => sameMember(m, member))) ?? null
}

/** Adds `added` to the project `to` belongs to (making one when `to` stands alone). */
export async function linkProjects(to: ProjectMemberRef, added: ProjectMemberRef): Promise<void> {
  if (sameMember(to, added)) return
  const link = linkOf(to) ?? { id: crypto.randomUUID(), members: [to] }
  const members = [...link.members.filter((m) => !sameMember(m, added)), added]
  setProjectLinks(await harnessRequest(HARNESS_METHODS.projectLinkSave, { link: { ...link, members } }, LOCAL_HOST))
}

/** Takes a host project out of its linked project; it lists on its own again. */
export async function unlinkProject(member: ProjectMemberRef): Promise<void> {
  const link = linkOf(member)
  if (!link) return
  const members = link.members.filter((m) => !sameMember(m, member))
  setProjectLinks(await harnessRequest(HARNESS_METHODS.projectLinkSave, { link: { ...link, members } }, LOCAL_HOST))
}
