import { stat } from 'node:fs/promises'
import { basename } from 'node:path'
import type { FolderInspection, HostingAccountRef, Project, PublishRepoParams } from '@zomfy/protocol'
import { isGitRepository } from './git-cli.ts'
import { credentialHelperKey, isHttpRemote, publishArgs, validAccount } from './hosting-accounts.ts'
import type { HostingAccounts } from './hosting-account-service.ts'
import { runHostingCli } from './hosting-cli.ts'
import { parseRemoteUrl, resolveHostingRemote } from './hosting-remote.ts'
import type { CloneAuth } from './repo-bootstrap.ts'
import { log } from './log.ts'
import type { WorkspaceManager } from './workspace-manager.ts'

// The Add a project dialog's account step on the daemon (docs/specs/add-project-dialog.md,
// docs/specs/project-hosting-accounts.md): what a folder is, cloning as an account, giving a new
// project its account, and publishing a new repository to GitHub.

export async function inspectFolder(path: string): Promise<FolderInspection> {
  const exists = await stat(path).then((s) => s.isDirectory(), () => false)
  if (!exists) return { path, exists: false, kind: null, remote: null, hasRemote: false }
  if (!(await isGitRepository(path))) return { path, exists: true, kind: 'folder', remote: null, hasRemote: false }
  // A folder just given a remote must not read as the remote-less one an earlier look cached.
  const { availability, remote } = await resolveHostingRemote(path, true)
  return {
    path,
    exists: true,
    kind: 'git',
    remote: remote ? { provider: remote.provider, host: remote.host, repo: remote.path } : null,
    hasRemote: availability.state !== 'no-remote' && availability.state !== 'not-git'
  }
}

/** A clone that authenticates as the account over HTTPS; nothing to add for SSH or glab's own login. */
export async function cloneAuth(accounts: HostingAccounts, url: string, account: HostingAccountRef | undefined): Promise<CloneAuth | undefined> {
  if (!account || !validAccount(account) || !isHttpRemote(url)) return undefined
  const host = parseRemoteUrl(url)?.host
  if (!host || host !== account.host.toLowerCase()) return undefined
  const helper = await accounts.helperFor(account)
  if (!helper) return undefined
  const key = credentialHelperKey(account.host)
  return { configArgs: ['-c', `${key}=`, '-c', `${key}=${helper}`], env: await accounts.env(account) }
}

/** Sets a new project's account and writes its credential helper; failures are logged, the project stays. */
export async function giveAccount(
  workspaces: WorkspaceManager,
  accounts: HostingAccounts,
  project: Project,
  account: HostingAccountRef | undefined
): Promise<Project> {
  if (!account || project.kind !== 'git' || !validAccount(account)) return project
  const previous = project.hostingAccount
  const updated = await workspaces.updateProject(project.id, { hostingAccount: account })
  await accounts.applyGitCredential(updated.path, previous, updated.hostingAccount).catch((error: unknown) => log(`credential helper for ${updated.path} not written: ${String(error)}`))
  return updated
}

/** `gh repo create … --push` as the account; returns why it failed, or null. */
export async function publishToGitHub(accounts: HostingAccounts, project: Project, publish: PublishRepoParams): Promise<string | null> {
  if (publish.account.provider !== 'github') return 'Publishing is only available for GitHub for now'
  const owner = publish.owner?.trim() || publish.account.login
  if (!/^[A-Za-z0-9][A-Za-z0-9-]*$/.test(owner)) return `${owner} is not a GitHub owner name`
  const args = publishArgs({ owner, name: basename(project.path), source: project.path, visibility: publish.visibility === 'public' ? 'public' : 'private' })
  try {
    // A GitHub Enterprise host comes from GH_HOST in the account's variables.
    await runHostingCli('gh', project.path, args, { env: await accounts.env(publish.account), timeoutMs: 120_000 })
    await resolveHostingRemote(project.path, true).catch(() => undefined)
    return null
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
}
