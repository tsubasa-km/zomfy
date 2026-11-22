// Settings: per host the scopes granted, routes and Unpair (forgets this phone's keys for it);
// the app's version and language.

import { Alert, Platform, ScrollView, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import type { PairedHost } from '../src/lib/host-connection'
import { app, APP_VERSION } from '../src/ui/app-model'
import { Button, routeLabel, Section, styles, TabBar } from '../src/ui/components'
import { useConnection, useConnectionState, useObservable } from '../src/ui/hooks'
import { language, t } from '../src/ui/i18n'

function confirmUnpair(host: PairedHost): void {
  const title = t('Unpair {host}?', { host: host.hostName })
  const body = t('This phone forgets its keys for this host. Revoke it in Zomfy too, under Settings → Devices.')
  if (Platform.OS === 'web') {
    if (globalThis.confirm?.(`${title}\n\n${body}`)) void app.unpair(host.hostId)
    return
  }
  Alert.alert(title, body, [
    { text: t('Cancel'), style: 'cancel' },
    { text: t('Unpair'), style: 'destructive', onPress: () => void app.unpair(host.hostId) }
  ])
}

function HostSettings({ host }: { host: PairedHost }) {
  const state = useConnectionState(useConnection(host.hostId))
  const scopes = state?.status === 'connected' ? state.scopes : host.scopes
  return (
    <View style={styles.card}>
      <Text style={[styles.text, { fontSize: 17, fontWeight: '600' }]}>{host.hostName}</Text>
      <Text style={styles.muted}>{t('Paired on {date}', { date: new Date(host.pairedAt).toLocaleDateString() })}</Text>
      <Text style={styles.muted}>
        {t('Device id')}: {host.deviceId} · {host.deviceName}
      </Text>
      <Section title={t('Scopes granted')}>
        {scopes.map((scope) => (
          <Text key={scope} style={styles.text}>
            • {t(scope)} <Text style={styles.muted}>({scope})</Text>
          </Text>
        ))}
      </Section>
      <Section title={t('Routes')}>
        {host.routes.map((route) => (
          <Text key={route.url} style={styles.muted}>
            {routeLabel(route)} · {route.url}
          </Text>
        ))}
      </Section>
      <Button label={t('Unpair')} kind="danger" onPress={() => confirmUnpair(host)} />
    </View>
  )
}

export default function SettingsScreen() {
  const hosts = useObservable(app.hosts)
  return (
    <SafeAreaView style={styles.screen} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.scroll}>
        {hosts.map((host) => (
          <HostSettings key={host.hostId} host={host} />
        ))}
        <View style={styles.card}>
          <Text style={styles.text}>
            {t('App version')}: {APP_VERSION}
          </Text>
          <Text style={styles.muted}>
            {t('Language')}: {language === 'ja' ? '日本語' : 'English'}
          </Text>
        </View>
      </ScrollView>
      <TabBar />
    </SafeAreaView>
  )
}
