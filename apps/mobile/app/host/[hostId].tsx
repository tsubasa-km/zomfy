// Host: projects → workspaces → chats, each chat with its state dot from the host.

import { useMemo } from 'react'
import { Pressable, ScrollView, Text, View } from 'react-native'
import { router, Stack, useLocalSearchParams } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import { hostTree, projectLabel, workspaceLabel } from '../../src/lib/host-tree'
import { Button, connectionColor, connectionLabel, Empty, routeLabel, Section, StatusDot, statusLabel, styles } from '../../src/ui/components'
import { useConnection, useConnectionState, useHost } from '../../src/ui/hooks'
import { t } from '../../src/ui/i18n'
import { colors, space } from '../../src/ui/theme'

export default function HostScreen() {
  const { hostId } = useLocalSearchParams<{ hostId: string }>()
  const host = useHost(hostId)
  const connection = useConnection(hostId)
  const state = useConnectionState(connection)
  const tree = useMemo(() => hostTree(state?.harness ?? null, state?.sessions ?? []), [state?.harness, state?.sessions])

  return (
    <SafeAreaView style={styles.screen} edges={['bottom']}>
      <Stack.Screen options={{ title: host?.hostName ?? t('Hosts') }} />
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.row}>
          <View style={[styles.dot, { backgroundColor: connectionColor(state?.status) }]} />
          <Text style={styles.muted}>
            {connectionLabel(state?.status)}
            {state?.status === 'connected' && state.route ? ` · ${routeLabel(state.route)}` : ''}
          </Text>
        </View>
        {state?.error && state.status !== 'connected' ? <Text style={styles.error}>{t(state.error)}</Text> : null}
        {state?.status === 'offline' ? <Button label={t('Retry now')} onPress={() => connection?.retryNow()} /> : null}
        {!state?.harness ? (
          <Empty title={state?.status === 'connected' ? t('Loading…') : t('Waiting for the host')} />
        ) : tree.length === 0 ? (
          <Empty title={t('No chats')} />
        ) : (
          tree.map((node) => (
            <Section key={node.project?.id ?? 'other'} title={node.project ? projectLabel(node.project) : t('Other')}>
              {node.workspaces.map(({ workspace, chats }) => (
                <View key={workspace.id} style={[styles.card, { gap: 2 }]}>
                  <Text style={[styles.text, { fontWeight: '600', marginBottom: space.xs }]}>{workspaceLabel(workspace)}</Text>
                  {chats.length === 0 ? <Text style={styles.muted}>{t('No chats')}</Text> : null}
                  {chats.map((chat) => (
                    <Pressable
                      key={chat.id}
                      style={({ pressed }) => [styles.row, { paddingVertical: space.sm }, pressed && { opacity: 0.6 }]}
                      onPress={() => router.push({ pathname: '/chat/[hostId]/[sessionId]', params: { hostId: hostId!, sessionId: chat.id } })}
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
              ))}
            </Section>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  )
}
