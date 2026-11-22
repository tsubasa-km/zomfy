// An approval or an agent's questions, answerable in place (Chat and Needs you).

import { useState } from 'react'
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { optionResponse, questionResponse, skipQuestionsResponse, type AgentQuestion, type PendingAsk } from '../lib/asks'
import { app } from './app-model'
import { Button, styles as shared } from './components'
import { t } from './i18n'
import { colors, space } from './theme'

function inputSummary(input: unknown): string | null {
  if (!input || typeof input !== 'object') return null
  const record = input as Record<string, unknown>
  for (const key of ['command', 'file_path', 'path', 'url', 'plan', 'description']) {
    if (typeof record[key] === 'string' && record[key]) return record[key] as string
  }
  return null
}

export function AskCard({ ask, context }: { ask: PendingAsk; context?: string }) {
  return ask.questions ? <QuestionCard ask={ask} questions={ask.questions} context={context} /> : <ApprovalCard ask={ask} context={context} />
}

function ApprovalCard({ ask, context }: { ask: PendingAsk; context?: string | undefined }) {
  const detail = inputSummary(ask.input)
  return (
    <View style={[shared.card, local.card]}>
      <Text style={local.kicker}>{t('Approval needed')}</Text>
      {context ? <Text style={shared.muted}>{context}</Text> : null}
      <Text style={local.title}>{ask.title}</Text>
      {detail && detail !== ask.title ? (
        <Text style={local.code} numberOfLines={8}>
          {detail}
        </Text>
      ) : null}
      <View style={local.options}>
        {ask.options.map((option) => (
          <Button
            key={option.optionId}
            label={option.name}
            kind={option.kind.startsWith('allow') ? 'primary' : option.kind.startsWith('reject') ? 'danger' : 'secondary'}
            onPress={() => app.asks.answer(ask.key, optionResponse(option.optionId))}
          />
        ))}
      </View>
    </View>
  )
}

function QuestionCard({ ask, questions, context }: { ask: PendingAsk; questions: AgentQuestion[]; context?: string | undefined }) {
  const [picked, setPicked] = useState<Record<string, string[]>>({})
  const [typed, setTyped] = useState<Record<string, string>>({})

  const toggle = (q: AgentQuestion, label: string) =>
    setPicked((current) => {
      const now = current[q.question] ?? []
      const next = q.multiSelect ? (now.includes(label) ? now.filter((l) => l !== label) : [...now, label]) : now.includes(label) ? [] : [label]
      return { ...current, [q.question]: next }
    })

  const answers: Record<string, string> = {}
  for (const q of questions) {
    const own = typed[q.question]?.trim()
    const value = own || (picked[q.question] ?? []).join(', ')
    if (value) answers[q.question] = value
  }
  const complete = questions.every((q) => answers[q.question])

  return (
    <View style={[shared.card, local.card]}>
      <Text style={local.kicker}>{t('The agent asks')}</Text>
      {context ? <Text style={shared.muted}>{context}</Text> : null}
      {questions.map((q) => (
        <View key={q.question} style={local.question}>
          {q.header ? <Text style={local.header}>{q.header}</Text> : null}
          <Text style={local.title}>{q.question}</Text>
          {q.options.map((option) => {
            const selected = (picked[q.question] ?? []).includes(option.label)
            return (
              <Pressable
                key={option.label}
                accessibilityRole={q.multiSelect ? 'checkbox' : 'radio'}
                accessibilityState={{ checked: selected }}
                onPress={() => toggle(q, option.label)}
                style={[local.choice, selected && local.choiceSelected]}
              >
                <Text style={local.choiceMark}>{q.multiSelect ? (selected ? '☑' : '☐') : selected ? '◉' : '○'}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={shared.text}>{option.label}</Text>
                  {option.description ? <Text style={shared.muted}>{option.description}</Text> : null}
                </View>
              </Pressable>
            )
          })}
          <TextInput
            style={shared.input}
            placeholder={t('Or type your own answer')}
            placeholderTextColor={colors.muted}
            value={typed[q.question] ?? ''}
            onChangeText={(text) => setTyped((current) => ({ ...current, [q.question]: text }))}
            multiline
          />
        </View>
      ))}
      <View style={local.options}>
        <Button label={t('Answer')} kind="primary" disabled={!complete} onPress={() => app.asks.answer(ask.key, questionResponse(answers))} />
        <Button label={t('Skip')} onPress={() => app.asks.answer(ask.key, skipQuestionsResponse())} />
      </View>
    </View>
  )
}

const local = StyleSheet.create({
  card: { borderColor: colors.warning },
  kicker: { color: colors.warning, fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.8 },
  title: { color: colors.text, fontSize: 15, fontWeight: '600' },
  header: { color: colors.muted, fontSize: 12, fontWeight: '700' },
  code: {
    color: colors.text,
    fontFamily: 'monospace',
    fontSize: 12,
    backgroundColor: colors.background,
    padding: space.sm,
    borderRadius: 6
  },
  options: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm },
  question: { gap: space.sm },
  choice: {
    flexDirection: 'row',
    gap: space.sm,
    alignItems: 'flex-start',
    padding: space.sm,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border
  },
  choiceSelected: { borderColor: colors.accent, backgroundColor: colors.userBubble },
  choiceMark: { color: colors.accent, fontSize: 16, width: 20 }
})
