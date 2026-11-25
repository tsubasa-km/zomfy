import { describe, expect, test } from 'bun:test'
import { normalizeWrapUp } from '@zomfy/protocol'
import { parseRecap } from '../src/components/native-chat/next-steps.ts'
import { buildTranscript } from '../src/components/native-chat/native-chat-transcript-model.ts'
import type { ThreadItem } from '../src/session-store.ts'

const RECAP = `Fixed the parser.

### やったこと
- Changed [parser](src/parser.ts)

### 確認状況
- 確認済み：bun test passed
- 未確認：the preview

### ネクストステップ
1. 〔Claude〕Run the preview
2. 〔あなた〕Decide whether to ship
   before Friday
3. 〔田中さん〕Review the PR`

describe('parseRecap', () => {
  test('splits the lead, the folded sections and the tagged steps', () => {
    const parsed = parseRecap(RECAP)
    expect(parsed?.lead).toBe('Fixed the parser.')
    expect(parsed?.sections.map((s) => s.title)).toEqual(['やったこと', '確認状況'])
    expect(parsed?.sections[1]?.body).toContain('未確認：the preview')
    expect(parsed?.steps).toEqual([
      { owner: 'agent', text: 'Run the preview' },
      { owner: 'person', text: 'Decide whether to ship before Friday' },
      { owner: '田中さん', text: 'Review the PR' }
    ])
  })

  test('reads English headings, bold headings and untagged steps', () => {
    const parsed = parseRecap('Done.\n\n**What I did**\n- a\n\n**Next steps:**\n- [You] Try it\n- Write docs')
    expect(parsed?.sections.map((s) => s.title)).toEqual(['What I did'])
    expect(parsed?.steps).toEqual([
      { owner: 'person', text: 'Try it' },
      { owner: 'agent', text: 'Write docs' }
    ])
  })

  test('leaves a message alone when next steps are not its end, or are not a list', () => {
    expect(parseRecap('### ネクストステップ\n1. 〔Claude〕a\n\nMore prose after the list.')).toBeNull()
    expect(parseRecap('### Next steps\nJust a paragraph.')).toBeNull()
    expect(parseRecap('No recap here.\n1. a')).toBeNull()
    // A heading inside a code block is not one.
    expect(parseRecap('```\n### Next steps\n1. a\n```')).toBeNull()
  })

  test('an unknown section before next steps stays in the lead', () => {
    const parsed = parseRecap('## Plan\nText\n\n### Next steps\n1. 〔Claude〕Go')
    expect(parsed?.sections).toEqual([])
    expect(parsed?.lead).toBe('## Plan\nText')
  })
})

describe('normalizeWrapUp', () => {
  test('keeps what it can show and drops what it cannot', () => {
    expect(
      normalizeWrapUp({
        summary: ' Did it. ',
        steps: [{ owner: 'Claude', text: 'Next' }, { owner: 'person' }, 'Plain'],
        question: { text: 'Ship?', options: ['Yes', '', 'No', 'Later', 'Never', 'Extra'] }
      })
    ).toEqual({
      summary: 'Did it.',
      steps: [
        { owner: 'agent', text: 'Next' },
        { owner: 'agent', text: 'Plain' }
      ],
      question: { text: 'Ship?', options: ['Yes', 'No', 'Later', 'Never'] }
    })
    expect(normalizeWrapUp({ steps: [] })).toBeNull()
    expect(normalizeWrapUp(null)).toBeNull()
  })
})

const user = (text: string): ThreadItem => ({ kind: 'user', text })
const agent = (text: string): ThreadItem => ({ kind: 'agent', text })
const wrapUp = (input: unknown): ThreadItem => ({
  kind: 'tool',
  id: 'w',
  title: 'wrap_up',
  toolKind: 'other',
  status: 'completed',
  input,
  output: '',
  toolName: 'mcp__harness__wrap_up'
})
const card = { summary: 'Did it.', steps: [{ owner: 'person', text: 'Check' }] }

describe('buildTranscript next steps', () => {
  test('a wrap_up call becomes a card under the reply, not a tool line', () => {
    const { rows } = buildTranscript([user('go'), wrapUp(card), agent('All done.')], false, '')
    expect(rows.map((r) => r.kind)).toEqual(['user', 'agent', 'next-steps'])
    expect(rows[2]).toMatchObject({ kind: 'next-steps', card })
  })

  test('the card waits for the turn to end', () => {
    const { rows } = buildTranscript([user('go'), wrapUp(card), agent('All')], true, '')
    expect(rows.map((r) => r.kind)).toEqual(['user', 'agent'])
  })

  test('a recap reply becomes the card, with the reply kept and the next prompt noted', () => {
    const { rows } = buildTranscript([user('go'), agent('Working…'), agent(RECAP), user('Yes')], false, '')
    expect(rows.map((r) => r.kind)).toEqual(['user', 'agent', 'next-steps', 'user'])
    const row = rows[2]
    if (row?.kind !== 'next-steps') throw new Error('no card')
    expect(row.recap?.text).toBe(RECAP)
    expect(row.card.steps).toHaveLength(3)
    expect(row.followUp).toBe('Yes')
  })

  test('with both, the call supplies the card and the reply its folded recap', () => {
    const { rows } = buildTranscript([user('go'), wrapUp(card), agent(RECAP)], false, '')
    const row = rows.at(-1)
    if (row?.kind !== 'next-steps') throw new Error('no card')
    expect(row.card).toEqual(card)
    expect(row.recap?.parsed.sections).toHaveLength(2)
  })

  test('answer, then wrap_up, then a short line: the card ends the turn under the reply', () => {
    const { rows } = buildTranscript([user('go'), agent('The full answer.'), wrapUp(card), agent('Done.')], false, '')
    expect(rows.map((r) => r.kind)).toEqual(['user', 'agent', 'agent', 'next-steps'])
    expect(rows[1]).toMatchObject({ kind: 'agent', text: 'The full answer.' })
    expect(rows[3]).toMatchObject({ kind: 'next-steps', card })
  })

  test('answer, then wrap_up, and no text after it: the card sits under the answer', () => {
    const { rows } = buildTranscript([user('go'), agent('The full answer.'), wrapUp(card)], false, '')
    expect(rows.map((r) => r.kind)).toEqual(['user', 'agent', 'next-steps'])
  })

  test('a recap in the answer before wrap_up still folds into the card, the short line kept after it', () => {
    const { rows } = buildTranscript([user('go'), agent(RECAP), wrapUp(card), agent('Done.'), user('Next')], false, '')
    expect(rows.map((r) => r.kind)).toEqual(['user', 'next-steps', 'agent', 'user'])
    const row = rows[1]
    if (row?.kind !== 'next-steps') throw new Error('no card')
    expect(row.card).toEqual(card)
    expect(row.recap?.text).toBe(RECAP)
    expect(row.followUp).toBe('Next')
  })

  test('a recap before the turn’s last tool call is not the turn’s recap', () => {
    const tool: ThreadItem = { kind: 'tool', id: 't', title: 'Read', toolKind: 'read', status: 'completed', input: {}, output: '', toolName: 'Read' }
    const { rows } = buildTranscript([user('go'), agent(RECAP), tool, agent('More.')], false, '')
    expect(rows.map((r) => r.kind)).toEqual(['user', 'agent', 'tools', 'agent'])
  })

  test('a reply without a recap stays as it was', () => {
    const { rows } = buildTranscript([user('go'), agent('Just an answer.')], false, '')
    expect(rows.map((r) => r.kind)).toEqual(['user', 'agent'])
  })
})
