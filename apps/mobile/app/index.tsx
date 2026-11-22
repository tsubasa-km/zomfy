// Hosts: every paired host, the route in use, its state, and how much waits for the person.

import { Pressable, ScrollView, Text, View } from 'react-native'
import { router } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import type { PairedHost } from '../src/lib/host-connection'
import { needsYouCount } from '../src/lib/host-tree'
import { app } from '../src/ui/app-model'
import { Button, connectionColor, connectionLabel, Empty, routeLabel, styles, TabBar } from '../src/ui/components'
import { useAsks, useConnection, useConnectionState, useNow, useObservable } from '../src/ui/hooks'
import { t } from '../src/ui/i18n'
import { colors } from '../src/ui/theme'

function HostRow({ host }: { host: PairedHost }) {
  const connection = useConnection(host.hostId)
  const state = useConnectionState(connection)
  const asks = useAsks()
  const now = useNow()
  const count = needsYouCount(
    asks.filter((a) => a.hostId === host.hostId),
    state?.sessions ?? []
  )
  const retryIn = state?.status === 'offline' && state.nextRetryAt ? Math.max(0, Math.ceil((state.nextRetryAt - now) / 1000)) : null
  return (
    <Pressable
      style={({ pressed }) => [styles.card, pressed && { opacity: 0.8 }]}
      onPress={() => router.push({ pathname: '/host/[hostId]', params: { hostId: host.hostId } })}
    >
      <View style={[styles.row, { justifyContent: 'space-between' }]}>
        <Text style={[styles.text, { fontSize: 17, fontWeight: '600' }]}>{host.hostName}</Text>
        {count > 0 ? <Text style={{ color: colors.warning, fontWeight: '700' }}>{t('{count} need you', { count })}</Text> : null}
      </View>
      <View style={styles.row}>
        <View style={[styles.dot, { backgroundColor: connectionColor(state?.status) }]} />
        <Text style={styles.muted}>
          {connectionLabel(state?.status)}
          {state?.status === 'connected' && state.route ? ` · ${routeLabel(state.route)}` : ''}
          {retryIn !== null ? ` · ${t('Retrying in {seconds}s', { seconds: retryIn })}` : ''}
        </Text>
      </View>
      {state?.error && state.status !== 'connected' ? <Text style={styles.error}>{t(state.error)}</Text> : null}
      {state?.status === 'offline' ? <Button label={t('Retry now')} onPress={() => connection?.retryNow()} /> : null}
      {state?.status === 'unpaired' ? <Button label={t('Pair again')} kind="primary" onPress={() => router.push('/pair')} /> : null}
    </Pressable>
  )
}

export default function HostsScreen() {
  const hosts = useObservable(app.hosts)
  return (
    <SafeAreaView style={styles.screen} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.scroll}>
        {hosts.length === 0 ? (
          <Empty
            title={t('No hosts yet')}
            body={t('Open Zomfy on your computer, go to Settings → Devices → Pair a phone, and scan the QR code.')}
          >
            <Button label={t('Pair a host')} kind="primary" onPress={() => router.push('/pair')} />
          </Empty>
        ) : (
          <>
            {hosts.map((host) => (
              <HostRow key={host.hostId} host={host} />
            ))}
            <Button label={t('Pair a host')} onPress={() => router.push('/pair')} />
          </>
        )}
      </ScrollView>
      <TabBar />
    </SafeAreaView>
  )
}
