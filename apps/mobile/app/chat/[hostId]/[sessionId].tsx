// Chat: the transcript (live), this chat's approval and question cards, and the composer with
// Send, and Stop while a turn runs. After a reconnect the transcript is loaded again. A message
// written while the host is unreachable is queued: it shows as a chip that can be removed, and is
// sent in order when the host is back. The draft survives a restart.

import { useEffect, useMemo, useRef, useState } from 'react'
import { FlatList, KeyboardAvoidingView, Platform, Pressable, Text, TextInput, View } from 'react-native'
import { Stack, useLocalSearchParams } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import type { TranscriptItem } from '../../../src/lib/transcript'
import { app } from '../../../src/ui/app-model'
import { AskCard } from '../../../src/ui/AskCard'
import { Button, connectionLabel, StatusDot, styles } from '../../../src/ui/components'
import { useAsks, useChatSession, useConnection, useConnectionState, useObservable } from '../../../src/ui/hooks'
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
  const [draft, setDraftState] = useState(() => (hostId && sessionId ? app.queue.draft(hostId, sessionId) : ''))
  const [sendError, setSendError] = useState<string | null>(null)
  const list = useRef<FlatList<TranscriptItem>>(null)
  const queueState = useObservable(app.queue.state)
  const queued = useMemo(() => queueState.queue.filter((p) => p.hostId === hostId && p.sessionId === sessionId), [queueState, hostId, sessionId])
  const draftTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const connected = state?.status === 'connected'
  const running = info?.status === 'working' || transcript.sending
  const canOperate = state?.scopes.includes('chats:operate') ?? false

  // The draft is kept a moment after the last keystroke, so a restart does not lose it.
  const setDraft = (text: string) => {
    setDraftState(text)
    if (draftTimer.current) clearTimeout(draftTimer.current)
    draftTimer.current = setTimeout(() => {
      if (hostId && sessionId) void app.queue.setDraft(hostId, sessionId, text)
    }, 400)
  }
  useEffect(() => () => {
    if (draftTimer.current) clearTimeout(draftTimer.current)
  }, [])

  const send = async () => {
    if (!hostId || !sessionId || !draft.trim()) return
    const text = draft.trim()
    setDraft('')
    setSendError(null)
    try {
      await app.sendOrQueue(hostId, sessionId, text)
    } catch (e) {
      setDraftState((current) => current || text)
      setSendError(e instanceof Error ? e.message : String(e))
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
        {queued.length > 0 ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.xs, paddingHorizontal: space.sm, paddingTop: space.xs }}>
            {queued.map((prompt) => (
              <Pressable
                key={prompt.id}
                accessibilityRole="button"
                accessibilityLabel={t('Remove queued message')}
                onPress={() => void app.queue.remove(prompt.id)}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: space.sm, paddingVertical: 4, borderRadius: 999, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceRaised, maxWidth: '100%' }}
              >
                <Text style={styles.muted} numberOfLines={1}>
                  {t('Queued')}: {prompt.text}
                </Text>
                <Text style={styles.muted}>×</Text>
              </Pressable>
            ))}
          </View>
        ) : null}
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
            label={connected ? t('Send') : t('Queue')}
            kind="primary"
            disabled={(connected && !canOperate) || !draft.trim()}
            onPress={() => void send()}
          />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}
