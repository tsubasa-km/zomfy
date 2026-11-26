// Needs you: every pending approval and question across hosts, newest first, answerable in place;
// then the chats a host marks as waiting whose ask this phone did not get.

import { Pressable, ScrollView, Text, View } from 'react-native'
import { router } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import type { SessionInfo } from '@zomfy/protocol'
import { visibleChat } from '../src/lib/host-tree'
import { AskCard } from '../src/ui/AskCard'
import { app } from '../src/ui/app-model'
import { Button, Empty, PhaseDot, styles, TabBar } from '../src/ui/components'
import { useAllConnectionStates, useAsks, useObservable } from '../src/ui/hooks'
import { t } from '../src/ui/i18n'

const openChat = (hostId: string, sessionId: string) =>
  router.push({ pathname: '/chat/[hostId]/[sessionId]', params: { hostId, sessionId } })

export default function NeedsYouScreen() {
  const asks = useAsks()
  const states = useAllConnectionStates()
  const hosts = useObservable(app.hosts)
  const hostName = (hostId: string) => hosts.find((h) => h.hostId === hostId)?.hostName ?? hostId
  const chatOf = (hostId: string, sessionId: string): SessionInfo | undefined =>
    states.get(hostId)?.sessions.find((s) => s.id === sessionId)

  const newest = [...asks].sort((a, b) => b.receivedAt - a.receivedAt)
  const waiting: { hostId: string; session: SessionInfo }[] = []
  for (const [hostId, state] of states) {
    for (const session of state.sessions) {
      if (visibleChat(session) && session.status === 'needs-you' && !asks.some((a) => a.hostId === hostId && a.sessionId === session.id)) {
        waiting.push({ hostId, session })
      }
    }
  }

  return (
    <SafeAreaView style={styles.screen} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.scroll}>
        {newest.length === 0 && waiting.length === 0 ? <Empty title={t('Nothing needs you')} /> : null}
        {newest.map((ask) => {
          const chat = chatOf(ask.hostId, ask.sessionId)
          return (
            <View key={ask.key} style={{ gap: 6 }}>
              <AskCard ask={ask} context={`${hostName(ask.hostId)} · ${chat?.title || t('Untitled chat')}`} />
              <Button label={t('Open chat')} onPress={() => openChat(ask.hostId, ask.sessionId)} />
            </View>
          )
        })}
        {waiting.map(({ hostId, session }) => (
          <Pressable key={`${hostId}/${session.id}`} style={styles.card} onPress={() => openChat(hostId, session.id)}>
            <View style={styles.row}>
              <PhaseDot info={session} />
              <Text style={[styles.text, { flex: 1 }]} numberOfLines={1}>
                {session.title || t('Untitled chat')}
              </Text>
            </View>
            <Text style={styles.muted}>{hostName(hostId)}</Text>
          </Pressable>
        ))}
      </ScrollView>
      <TabBar />
    </SafeAreaView>
  )
}
