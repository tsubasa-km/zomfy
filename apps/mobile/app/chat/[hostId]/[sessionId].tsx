// Chat: the transcript (live), this chat's approval and question cards, and the composer with
// Send, and Stop while a turn runs. After a reconnect the transcript is loaded again.

import { useMemo, useRef, useState } from 'react'
import { FlatList, KeyboardAvoidingView, Platform, Text, TextInput, View } from 'react-native'
import { Stack, useLocalSearchParams } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import type { TranscriptItem } from '../../../src/lib/transcript'
import { AskCard } from '../../../src/ui/AskCard'
import { Button, connectionLabel, StatusDot, styles } from '../../../src/ui/components'
import { useAsks, useChatSession, useConnection, useConnectionState } from '../../../src/ui/hooks'
import { t } from '../../../src/ui/i18n'
import { TranscriptItemView } from '../../../src/ui/TranscriptItemView'
import { colors, space } from '../../../src/ui/theme'

export default function ChatScreen() {
  const { hostId, sessionId } = useLocalSearchParams<{ hostId: string; sessionId: string }>()
  const connection = useConnection(hostId)
  const state = useConnectionState(connection)
  const { chat, state: transcript } = useChatSession(connection, sessionId)
  const asks = useAsks()
  const mine = useMemo(() => asks.filter((a) => a.hostId === hostId && a.sessionId === sessionId), [asks, hostId, sessionId])
  const info = state?.sessions.find((s) => s.id === sessionId)
  const [draft, setDraft] = useState('')
  const [sendError, setSendError] = useState<string | null>(null)
  const list = useRef<FlatList<TranscriptItem>>(null)

  const connected = state?.status === 'connected'
  const running = info?.status === 'working' || transcript.sending
  const canOperate = state?.scopes.includes('chats:operate') ?? false

  const send = async () => {
    if (!chat || !draft.trim()) return
    const text = draft
    setDraft('')
    setSendError(null)
    const outcome = await chat.send(text)
    if (!outcome.sent) {
      // Not sent: the message goes back into the box.
      setDraft((current) => current || text)
      setSendError(outcome.error)
    }
  }

  const stop = () => {
    try {
      chat?.stop()
    } catch (e) {
      setSendError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <SafeAreaView style={styles.screen} edges={['bottom']}>
      <Stack.Screen options={{ title: info?.title || t('Untitled chat') }} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        {!connected ? (
          <View style={{ padding: space.sm, backgroundColor: colors.surfaceRaised }}>
            <Text style={[styles.muted, { textAlign: 'center' }]}>{connectionLabel(state?.status)}</Text>
          </View>
        ) : null}
        <FlatList
          ref={list}
          data={transcript.items}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => <TranscriptItemView item={item} />}
          contentContainerStyle={{ padding: space.md, gap: space.sm }}
          onContentSizeChange={() => list.current?.scrollToEnd({ animated: false })}
          ListHeaderComponent={
            transcript.loading ? (
              <Text style={[styles.muted, { textAlign: 'center' }]}>{t('Loading…')}</Text>
            ) : transcript.error ? (
              <Text style={styles.error}>{t(transcript.error)}</Text>
            ) : undefined
          }
          ListFooterComponent={
            mine.length > 0 ? (
              <View style={{ gap: space.sm, marginTop: space.sm }}>
                {mine.map((ask) => (
                  <AskCard key={ask.key} ask={ask} />
                ))}
              </View>
            ) : undefined
          }
        />
        {sendError ? <Text style={[styles.error, { paddingHorizontal: space.md }]}>{t(sendError)}</Text> : null}
        <View style={{ flexDirection: 'row', gap: space.sm, padding: space.sm, borderTopWidth: 1, borderTopColor: colors.border, alignItems: 'flex-end' }}>
          {info ? <View style={{ paddingBottom: 14 }}><StatusDot status={info.status} /></View> : null}
          <TextInput
            style={[styles.input, { flex: 1, maxHeight: 140 }]}
            value={draft}
            onChangeText={setDraft}
            placeholder={t('Message')}
            placeholderTextColor={colors.muted}
            multiline
            editable={canOperate}
          />
          {running ? (
            <Button label={t('Stop')} kind="danger" disabled={!connected || !canOperate} onPress={stop} />
          ) : null}
          <Button
            label={t('Send')}
            kind="primary"
            disabled={!connected || !canOperate || !draft.trim()}
            onPress={() => void send()}
          />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}
