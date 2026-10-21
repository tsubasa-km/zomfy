// Mirrors Orca's sanitizeWorktreeName (src/main/ipc/worktree-logic.ts) and branch-prefix rules.

export function sanitizeWorkspaceName(input: string): string {
  const slug = input
    .trim()
    .replace(/[^\p{L}\p{N}._-]+/gu, '-')
    .replace(/-{2,}/g, '-')
    .replace(/\.{2,}/g, '.')
    .replace(/^[.-]+|[.-]+$/g, '')
  return slug || 'workspace'
}

export function branchPrefixFromUserName(userName: string | null): string | null {
  if (!userName) return null
  const prefix = sanitizeWorkspaceName(userName).toLowerCase()
  return prefix === 'workspace' ? null : prefix
}

/** `name`, then `name-2`, `name-3`… until `isFree` accepts one. */
export async function firstFreeCandidate(
  name: string,
  isFree: (candidate: string) => Promise<boolean>
): Promise<string> {
  for (let n = 1; n < 1000; n++) {
    const candidate = n === 1 ? name : `${name}-${n}`
    if (await isFree(candidate)) return candidate
  }
  throw new Error(`No free workspace name for ${name}`)
}
