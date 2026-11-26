import type { ChatCommand, ChatCommandKind, ChatMcpServer } from '@zomfy/protocol'

// What the composer's `/` and `@` menus list, and in which order; kept apart from the drawing so it
// can be tested (composer-skills-and-connectors.md).

const MAX_FILE_MATCHES = 50
/** Typed after `@`, it narrows the menu to MCP servers. */
export const MCP_MENTION_QUERY = 'mcp:'

/** What the caret sits in: a leading `/command`, an `@path`, or neither. */
export function composerAutocompleteQuery(
  text: string,
  caret: number
): { mode: 'slash' | 'mention'; query: string; start: number; end: number } | null {
  const before = text.slice(0, caret)
  const slash = /^\/(\S*)$/.exec(before)
  if (slash) return { mode: 'slash', query: slash[1] ?? '', start: 0, end: caret }
  const mention = /(^|\s)@([^\s@]*)$/.exec(before)
  if (mention) {
    const query = mention[2] ?? ''
    return { mode: 'mention', query, start: caret - query.length - 1, end: caret }
  }
  return null
}

/** A row's kind; a row from an older daemon or another agent says none and is a command. */
export function commandKindOf(command: ChatCommand): ChatCommandKind {
  return command.kind ?? 'command'
}

const GROUP_ORDER: readonly ChatCommandKind[] = ['command', 'skill', 'mcp-prompt']

/** The `/` menu's groups, in the order drawn: commands (Claude Code's own first), skills, MCP prompts. */
export function slashGroups(items: readonly ChatCommand[]): { kind: ChatCommandKind; items: ChatCommand[] }[] {
  return GROUP_ORDER.map((kind) => {
    const inGroup = items.filter((c) => commandKindOf(c) === kind)
    // Within commands, Claude Code's own come first, as before skills had a group of their own.
    const sorted = kind === 'command' ? [...inGroup.filter((c) => c.builtin), ...inGroup.filter((c) => !c.builtin)] : inGroup
    return { kind, items: sorted }
  }).filter((group) => group.items.length > 0)
}

/** The commands in the order the menu draws them, so the active index means the same row. */
export function slashMenuOrder(items: readonly ChatCommand[]): ChatCommand[] {
  return slashGroups(items).flatMap((group) => group.items)
}

/** Name matches that start with the query before those that contain it, in the menu's order. */
export function matchCommands(commands: readonly ChatCommand[], query: string): ChatCommand[] {
  const q = query.toLowerCase()
  const starts = commands.filter((c) => c.name.toLowerCase().startsWith(q))
  const contains = commands.filter((c) => !c.name.toLowerCase().startsWith(q) && c.name.toLowerCase().includes(q))
  return slashMenuOrder([...starts, ...contains])
}

/** The skills among a command list, for the + menu's Skill list, filtered by name or description. */
export function matchSkills(commands: readonly ChatCommand[], query: string): ChatCommand[] {
  const skills = commands.filter((c) => commandKindOf(c) === 'skill')
  const q = query.trim().toLowerCase()
  if (!q) return skills
  const starts = skills.filter((c) => c.name.toLowerCase().startsWith(q))
  const rest = skills.filter(
    (c) => !c.name.toLowerCase().startsWith(q) && (c.name.toLowerCase().includes(q) || c.description.toLowerCase().includes(q))
  )
  return [...starts, ...rest]
}

/** How much of the draft a leading `/command` and the spaces after it take; 0 without one. */
export function leadingCommandLength(draft: string): number {
  return /^\/\S*[^\S\n]*/.exec(draft)?.[0].length ?? 0
}

/** The draft with `/name ` at its start, in place of a leading `/command` already there. */
export function withLeadingCommand(draft: string, name: string): string {
  return `/${name} ${draft.slice(leadingCommandLength(draft))}`
}

/** Filename matches before path matches, shorter paths first, like Orca's quick open. */
export function matchFiles(files: readonly string[], query: string): string[] {
  const q = query.toLowerCase().replaceAll('\\', '/')
  if (!q) return files.slice(0, MAX_FILE_MATCHES)
  const scored: { path: string; score: number }[] = []
  for (const path of files) {
    const lower = path.toLowerCase()
    const name = lower.slice(lower.lastIndexOf('/') + 1)
    const score = name.startsWith(q) ? 0 : name.includes(q) ? 1 : lower.includes(q) ? 2 : -1
    if (score >= 0) scored.push({ path, score })
  }
  return scored
    .sort((a, b) => a.score - b.score || a.path.length - b.path.length)
    .slice(0, MAX_FILE_MATCHES)
    .map((s) => s.path)
}

/** The servers a composer may offer: connected, and not the harness's own. */
export function offeredConnectors(servers: readonly ChatMcpServer[]): ChatMcpServer[] {
  return servers.filter((s) => s.status === 'connected' && !s.harness)
}

export type MentionOption = { kind: 'file'; path: string } | { kind: 'mcp'; server: ChatMcpServer }

/** 0: the name or one of its words starts with the query; 1: it contains it; -1: no match. */
function serverScore(name: string, q: string): number {
  const lower = name.toLowerCase()
  if (lower.startsWith(q) || lower.split(/[\s._:-]+/).some((word) => word.startsWith(q))) return 0
  return lower.includes(q) ? 1 : -1
}

/**
 * The `@` menu's rows. With nothing typed, files then servers; with a query, servers whose name
 * (or a word of it) starts with it, then files, then servers that merely contain it. `@mcp:` lists
 * servers only.
 */
export function matchMentions(files: readonly string[], servers: readonly ChatMcpServer[], query: string): MentionOption[] {
  const q = query.toLowerCase()
  const server = (s: ChatMcpServer): MentionOption => ({ kind: 'mcp', server: s })
  if (q.startsWith(MCP_MENTION_QUERY)) {
    const rest = q.slice(MCP_MENTION_QUERY.length)
    if (!rest) return servers.map(server)
    const scored = servers.map((s) => ({ s, score: serverScore(s.name, rest) })).filter((x) => x.score >= 0)
    return scored.sort((a, b) => a.score - b.score).map((x) => server(x.s))
  }
  const fileRows = matchFiles(files, query).map((path): MentionOption => ({ kind: 'file', path }))
  if (!q) return [...fileRows, ...servers.map(server)]
  const first = servers.filter((s) => serverScore(s.name, q) === 0).map(server)
  const last = servers.filter((s) => serverScore(s.name, q) === 1).map(server)
  return [...first, ...fileRows, ...last]
}
