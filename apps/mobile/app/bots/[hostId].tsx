// Bots (docs/specs/mobile/bots.md): the host's bots with their avatar, handle and paused state,
// Talk to start a chat from a first message, and each bot's recent chats.

import { useMemo, useState } from 'react'
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native'
import { router, Stack, useLocalSearchParams } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import type { Bot, SessionInfo } from '@zomfy/protocol'
import { canTalk, recentBotChats, sortBots, startBotChat } from '../../src/lib/bots'
import type { HostConnection } from '../../src/lib/host-connection'
import { BotAvatar, Button, connectionLabel, Empty, StatusDot, statusLabel, styles } from '../../src/ui/components'
import { useConnection, useConnectionState, useHost } from '../../src/ui/hooks'
import { t } from '../../src/ui/i18n'
import { colors, space } from '../../src/ui/theme'

export default function BotsScreen() {
  const { hostId } = useLocalSearchParams<{ hostId: string }>()
  const host = useHost(hostId)
  const connection = useConnection(hostId)
  const state = useConnectionState(connection)
  const bots = useMemo(() => sortBots(state?.bots ?? []), [state?.bots])
  const recent = useMemo(() => recentBotChats(state?.sessions ?? []), [state?.sessions])
  const [talking, setTalking] = useState<string | null>(null)
  const connected = state?.status === 'connected'
  const scopes = state?.scopes ?? []

  return (
    <SafeAreaView style={styles.screen} edges={['bottom']}>
      <Stack.Screen options={{ title: host ? `${t('Bots')} · ${host.hostName}` : t('Bots') }} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          {!connected ? <Text style={[styles.muted, { textAlign: 'center' }]}>{connectionLabel(state?.status)}</Text> : null}
          {!state?.bots ? (
            <Empty title={connected ? t('Loading…') : t('Waiting for the host')} />
          ) : bots.length === 0 ? (
            <Empty title={t('No bots on this host')} />
          ) : (
            bots.map((bot) => (
              <BotCard
                key={bot.id}
                bot={bot}
                hostId={hostId!}
                connection={connection}
                connected={connected}
                mayTalk={canTalk(bot, scopes)}
                mayOperate={scopes.includes('chats:operate')}
                chats={recent.get(bot.id) ?? []}
                open={talking === bot.id}
                onToggle={() => setTalking((id) => (id === bot.id ? null : bot.id))}
              />
            ))
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}

function BotCard(props: {
  bot: Bot
  hostId: string
  connection: HostConnection | undefined
  connected: boolean
  mayTalk: boolean
  mayOperate: boolean
  chats: SessionInfo[]
  open: boolean
  onToggle: () => void
}) {
  const { bot, hostId } = props
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const openChat = (sessionId: string) => router.push({ pathname: '/chat/[hostId]/[sessionId]', params: { hostId, sessionId } })

  const send = async () => {
    if (!props.connection) return
    setBusy(true)
    setError(null)
    try {
      const sessionId = await startBotChat(props.connection, bot.id, text)
      setText('')
      props.onToggle()
      openChat(sessionId)
    } catch (e) {
      // The text stays, so it can be sent again.
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <View style={styles.card} testID={`bot-${bot.handle}`}>
      <View style={styles.row}>
        <BotAvatar bot={bot} size={40} />
        <View style={{ flex: 1 }}>
          <Text style={[styles.text, { fontWeight: '600' }]} numberOfLines={1}>
            {bot.name}
          </Text>
          <Text style={styles.muted} numberOfLines={1}>
            @{bot.handle}
            {bot.isDefault ? ` · ${t('Default')}` : ''}
            {bot.paused ? ` · ${t('Paused')}` : ''}
          </Text>
        </View>
        {props.mayTalk && !props.open ? <Button label={t('Talk')} kind="primary" onPress={props.onToggle} /> : null}
      </View>
      {bot.purpose ? <Text style={styles.muted}>{bot.purpose}</Text> : null}
      {props.open ? (
        <View style={{ gap: space.sm }}>
          <TextInput
            style={[styles.input, { minHeight: 80, textAlignVertical: 'top' }]}
            value={text}
            onChangeText={setText}
            placeholder={t('Message to {name}', { name: bot.name })}
            placeholderTextColor={colors.muted}
            multiline
            autoFocus
          />
          {!props.connected ? <Text style={styles.muted}>{t('Connect to the host to start a chat')}</Text> : null}
          {error ? <Text style={styles.error}>{t(error)}</Text> : null}
          <View style={[styles.row, { justifyContent: 'flex-end' }]}>
            <Button label={t('Cancel')} onPress={props.onToggle} disabled={busy} />
            <Button label={t('Start chat')} kind="primary" busy={busy} disabled={!props.connected || !text.trim()} onPress={() => void send()} />
          </View>
        </View>
      ) : null}
      {!props.mayOperate && !bot.paused ? <Text style={styles.muted}>{t('This phone may not start chats on this host')}</Text> : null}
      <Text style={[styles.sectionTitle, { marginTop: space.xs }]}>{t('Recent chats')}</Text>
      {props.chats.length === 0 ? <Text style={styles.muted}>{t('No chats with this bot yet')}</Text> : null}
      {props.chats.map((chat) => (
        <Pressable
          key={chat.id}
          style={({ pressed }) => [styles.row, { paddingVertical: space.xs }, pressed && { opacity: 0.6 }]}
          onPress={() => openChat(chat.id)}
        >
          <StatusDot status={chat.status} />
          <Text style={[styles.text, { flex: 1 }]} numberOfLines={1}>
            {chat.title || t('Untitled chat')}
          </Text>
          {chat.status !== 'idle' ? (
            <Text style={{ color: chat.status === 'error' ? colors.danger : colors.muted, fontSize: 12 }}>{statusLabel(chat.status)}</Text>
          ) : null}
        </Pressable>
      ))}
    </View>
  )
}
