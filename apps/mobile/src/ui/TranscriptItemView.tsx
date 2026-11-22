import { memo, useState, type ReactNode } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { toolSummary, type TranscriptItem } from '../lib/transcript'
import { styles as shared } from './components'
import { t } from './i18n'
import { colors, space } from './theme'

const MAX_SHOWN = 4000

const clip = (text: string): string => (text.length > MAX_SHOWN ? `${text.slice(0, MAX_SHOWN)}…` : text)

function inputText(input: unknown): string {
  if (input === null || input === undefined) return ''
  if (typeof input === 'string') return input
  try {
    return JSON.stringify(input, null, 2)
  } catch {
    return String(input)
  }
}

const toolMark = (status: string): string =>
  status === 'completed' ? '✓' : status === 'failed' ? '✗' : status === 'in_progress' ? '…' : '•'

const planMark = (status: string): string => (status === 'completed' ? '☑' : status === 'in_progress' ? '◐' : '☐')

function Collapsible({ line, mark, markColor, children }: { line: string; mark: string; markColor: string; children: () => ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <View style={local.tool}>
      <Pressable onPress={() => setOpen(!open)} style={local.toolLine} accessibilityRole="button" accessibilityState={{ expanded: open }}>
        <Text style={[local.toolMark, { color: markColor }]}>{mark}</Text>
        <Text style={local.toolText} numberOfLines={open ? undefined : 1}>
          {line}
        </Text>
        <Text style={shared.muted}>{open ? '▾' : '▸'}</Text>
      </Pressable>
      {open ? <View style={local.toolBody}>{children()}</View> : null}
    </View>
  )
}

export const TranscriptItemView = memo(function TranscriptItemView({ item }: { item: TranscriptItem }) {
  switch (item.kind) {
    case 'user':
      return (
        <View style={local.userBubble}>
          <Text style={shared.text} selectable>
            {item.text}
          </Text>
        </View>
      )
    case 'agent':
      return (
        <Text style={[shared.text, local.agent]} selectable>
          {item.text}
        </Text>
      )
    case 'thought':
      return (
        <Collapsible line={t('Thinking')} mark="∴" markColor={colors.muted}>
          {() => <Text style={[shared.muted, local.italic]}>{clip(item.text)}</Text>}
        </Collapsible>
      )
    case 'tool': {
      const color = item.status === 'failed' ? colors.danger : item.status === 'completed' ? colors.success : colors.accent
      return (
        <Collapsible line={toolSummary(item)} mark={toolMark(item.status)} markColor={color}>
          {() => (
            <>
              {item.input !== null ? (
                <Text style={local.code} selectable>
                  {clip(inputText(item.input))}
                </Text>
              ) : null}
              {item.output ? (
                <Text style={local.code} selectable>
                  {clip(item.output)}
                </Text>
              ) : null}
            </>
          )}
        </Collapsible>
      )
    }
    case 'plan':
      return (
        <View style={[shared.card, local.plan]}>
          <Text style={shared.sectionTitle}>{t('Plan')}</Text>
          {item.entries.map((entry, i) => (
            <View key={i} style={shared.row}>
              <Text style={{ color: entry.status === 'completed' ? colors.success : colors.muted }}>{planMark(entry.status)}</Text>
              <Text style={[shared.text, entry.status === 'completed' && local.done]}>{entry.content}</Text>
            </View>
          ))}
        </View>
      )
    case 'notice': {
      const color = item.severity === 'error' ? colors.danger : item.severity === 'warning' ? colors.warning : colors.muted
      return (
        <View style={local.notice}>
          <Text style={[local.noticeText, { color }]}>{item.title}</Text>
          {item.description ? <Text style={[shared.muted, local.center]}>{item.description}</Text> : null}
        </View>
      )
    }
  }
})

const local = StyleSheet.create({
  userBubble: {
    alignSelf: 'flex-end',
    maxWidth: '88%',
    backgroundColor: colors.userBubble,
    borderRadius: 14,
    paddingHorizontal: space.md,
    paddingVertical: space.sm
  },
  agent: { lineHeight: 21 },
  italic: { fontStyle: 'italic' },
  tool: { borderRadius: 8, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  toolLine: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingHorizontal: space.sm, paddingVertical: 6 },
  toolMark: { width: 16, textAlign: 'center', fontWeight: '700' },
  toolText: { flex: 1, color: colors.text, fontSize: 13, fontFamily: 'monospace' },
  toolBody: { paddingHorizontal: space.sm, paddingBottom: space.sm, gap: space.sm },
  code: { color: colors.text, fontSize: 12, fontFamily: 'monospace', backgroundColor: colors.background, padding: space.sm, borderRadius: 6 },
  plan: { gap: 6 },
  done: { color: colors.muted, textDecorationLine: 'line-through' },
  notice: { alignItems: 'center', paddingVertical: 2 },
  noticeText: { fontSize: 12, textAlign: 'center' },
  center: { textAlign: 'center' }
})
