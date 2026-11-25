import { describe, expect, test } from 'bun:test'
import type { ChatCommand, ChatMcpServer } from '@zomfy/protocol'
import {
  leadingCommandLength,
  matchCommands,
  matchMentions,
  matchSkills,
  offeredConnectors,
  slashGroups,
  slashMenuOrder,
  withLeadingCommand
} from '../src/components/native-chat/composer-menu-items.ts'
import { decodeMcpServer, mcpMentionText, parseChatMentions } from '../src/lib/chat-mentions.ts'

const command = (name: string, extra: Partial<ChatCommand> = {}): ChatCommand => ({ name, description: '', argumentHint: '', ...extra })
const server = (name: string, status: ChatMcpServer['status'] = 'connected', harness = false): ChatMcpServer => ({
  name,
  status,
  scope: null,
  transport: null,
  tools: [],
  harness
})

describe('the / menu', () => {
  const commands = [
    command('okf-generate', { kind: 'skill' }),
    command('my-command', { kind: 'command' }),
    command('compact', { builtin: true, kind: 'command' }),
    command('mcp__github__review', { kind: 'mcp-prompt' }),
    command('code-review', { builtin: true, kind: 'skill' })
  ]

  test('groups commands (built-in first), then skills, then MCP prompts', () => {
    expect(slashGroups(commands).map((g) => [g.kind, g.items.map((c) => c.name)])).toEqual([
      ['command', ['compact', 'my-command']],
      ['skill', ['okf-generate', 'code-review']],
      ['mcp-prompt', ['mcp__github__review']]
    ])
    expect(slashMenuOrder(commands).map((c) => c.name)).toEqual(['compact', 'my-command', 'okf-generate', 'code-review', 'mcp__github__review'])
  })

  test('rows without a kind (an older daemon, another agent) are commands', () => {
    expect(slashGroups([command('a'), command('b', { builtin: true })]).map((g) => [g.kind, g.items.map((c) => c.name)])).toEqual([
      ['command', ['b', 'a']]
    ])
  })

  test('matches keep the groups, starts-with before contains within each', () => {
    expect(matchCommands(commands, 'co').map((c) => c.name)).toEqual(['compact', 'my-command', 'code-review'])
    expect(matchCommands(commands, 'review').map((c) => c.name)).toEqual(['code-review', 'mcp__github__review'])
  })
})

describe('the + menu skills', () => {
  const commands = [
    command('okf-generate', { kind: 'skill', description: 'Write an OKF bundle' }),
    command('drawio', { kind: 'skill', description: 'Draw a diagram' }),
    command('compact', { builtin: true, kind: 'command' })
  ]

  test('lists skills only, filtered by name then description', () => {
    expect(matchSkills(commands, '').map((c) => c.name)).toEqual(['okf-generate', 'drawio'])
    expect(matchSkills(commands, 'diagram').map((c) => c.name)).toEqual(['drawio'])
    expect(matchSkills(commands, 'compact')).toEqual([])
  })

  test('a skill replaces a leading command and keeps the rest', () => {
    expect(withLeadingCommand('', 'drawio')).toBe('/drawio ')
    expect(withLeadingCommand('make a chart', 'drawio')).toBe('/drawio make a chart')
    expect(withLeadingCommand('/okf-generate  the docs', 'drawio')).toBe('/drawio the docs')
    expect(withLeadingCommand('/okf\nnext line', 'drawio')).toBe('/drawio \nnext line')
    expect(leadingCommandLength('no command')).toBe(0)
  })
})

describe('the @ menu', () => {
  const files = ['src/notion.ts', 'README.md', 'src/github-client.ts']
  const servers = [server('notion'), server('claude.ai Google Calendar'), server('my-github')]

  test('with nothing typed, files then servers', () => {
    expect(matchMentions(files, servers, '').map((o) => (o.kind === 'file' ? o.path : `mcp:${o.server.name}`))).toEqual([
      'src/notion.ts',
      'README.md',
      'src/github-client.ts',
      'mcp:notion',
      'mcp:claude.ai Google Calendar',
      'mcp:my-github'
    ])
  })

  test('a server whose name or a word of it starts with the query comes first; one that only contains it last', () => {
    const rows = (q: string) => matchMentions(files, servers, q).map((o) => (o.kind === 'file' ? o.path : `mcp:${o.server.name}`))
    expect(rows('notion')).toEqual(['mcp:notion', 'src/notion.ts'])
    expect(rows('google')).toEqual(['mcp:claude.ai Google Calendar'])
    expect(rows('github')).toEqual(['mcp:my-github', 'src/github-client.ts'])
    expect(rows('hub')).toEqual(['src/github-client.ts', 'mcp:my-github'])
  })

  test('@mcp: lists servers only', () => {
    expect(matchMentions(files, servers, 'mcp:').map((o) => o.kind)).toEqual(['mcp', 'mcp', 'mcp'])
    expect(matchMentions(files, servers, 'MCP:cal').map((o) => (o.kind === 'mcp' ? o.server.name : ''))).toEqual([
      'claude.ai Google Calendar'
    ])
  })

  test('only connected servers that are not the harness own are offered', () => {
    const all = [server('a'), server('b', 'failed'), server('c', 'needs-auth'), server('zomfy', 'connected', true), server('d', 'pending')]
    expect(offeredConnectors(all).map((s) => s.name)).toEqual(['a'])
  })
})

describe('@mcp: chips', () => {
  test('a name with spaces is one percent-encoded word, and reads back', () => {
    expect(mcpMentionText('claude.ai Google Calendar')).toBe('@mcp:claude.ai%20Google%20Calendar ')
    expect(mcpMentionText('100%')).toBe('@mcp:100%25 ')
    expect(decodeMcpServer('claude.ai%20Google%20Calendar')).toBe('claude.ai Google Calendar')
    expect(decodeMcpServer('%E0%A4%A')).toBeNull()
  })

  test('parse as mcp mentions, not files; a draft needs the space after it', () => {
    const draft = `ask ${mcpMentionText('claude.ai Gmail')}and @src/a.ts now`
    expect(parseChatMentions(draft).map((m) => [m.kind, m.path, m.label])).toEqual([
      ['mcp', 'claude.ai Gmail', 'claude.ai Gmail'],
      ['file', 'src/a.ts', 'a.ts']
    ])
    expect(parseChatMentions('still typing @mcp:not')).toEqual([])
    expect(parseChatMentions('sent @mcp:notion', { sent: true }).map((m) => m.kind)).toEqual(['mcp'])
  })
})
