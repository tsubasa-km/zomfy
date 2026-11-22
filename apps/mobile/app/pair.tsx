// Pair: scan the QR code Zomfy shows (Settings → Devices → Pair a phone) or paste its link, name
// the phone, and pair. A `zomfy://pair#<offer>` link opens this screen with the offer filled in.

import { useEffect, useState } from 'react'
import { Platform, ScrollView, Text, TextInput, View } from 'react-native'
import { CameraView, useCameraPermissions } from 'expo-camera'
import * as Clipboard from 'expo-clipboard'
import * as Device from 'expo-device'
import * as Linking from 'expo-linking'
import { router } from 'expo-router'
import { SafeAreaView } from 'react-native-safe-area-context'
import type { PairingOffer } from '@zomfy/protocol'
import { pairFromOffer } from '../src/lib/host-registry'
import { readOffer } from '../src/lib/pairing'
import { app, appFetch, randomBytes } from '../src/ui/app-model'
import { Button, routeLabel, Section, styles } from '../src/ui/components'
import { useNow } from '../src/ui/hooks'
import { t } from '../src/ui/i18n'
import { colors } from '../src/ui/theme'

const offerIn = (url: string | null): string | null => (url && url.includes('#') && /pair/i.test(url) ? url : null)

function Scanner({ onScanned }: { onScanned: (data: string) => void }) {
  const [permission, requestPermission] = useCameraPermissions()
  if (!permission) return null
  if (!permission.granted) {
    return (
      <View style={styles.card}>
        <Text style={styles.text}>{t('Camera access is needed to scan the code.')}</Text>
        <Button label={t('Allow camera')} kind="primary" onPress={() => void requestPermission()} />
      </View>
    )
  }
  return (
    <View style={{ gap: 8 }}>
      <View style={{ aspectRatio: 1, borderRadius: 12, overflow: 'hidden', backgroundColor: '#000' }}>
        <CameraView
          style={{ flex: 1 }}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          onBarcodeScanned={(result) => onScanned(result.data)}
        />
      </View>
      <Text style={styles.muted}>{t('Point the camera at the QR code in Zomfy.')}</Text>
    </View>
  )
}

export default function PairScreen() {
  const url = Linking.useURL()
  const [link, setLink] = useState('')
  const [offer, setOffer] = useState<PairingOffer | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [scanning, setScanning] = useState(Platform.OS !== 'web')
  const [name, setName] = useState(Device.modelName ?? 'Android phone')
  const [busy, setBusy] = useState(false)
  const now = useNow()

  const take = (text: string): boolean => {
    setLink(text)
    try {
      setOffer(readOffer(text))
      setError(null)
      setScanning(false)
      return true
    } catch (e) {
      setOffer(null)
      setError(e instanceof Error ? e.message : String(e))
      return false
    }
  }

  useEffect(() => {
    const fromLink = offerIn(url) ?? (Platform.OS === 'web' ? offerIn(globalThis.location?.href ?? null) : null)
    if (fromLink) take(fromLink)
  }, [url])

  const paste = async () => {
    const text = await Clipboard.getStringAsync().catch(() => '')
    if (text) take(text)
  }

  const pair = async () => {
    if (!offer) return
    setBusy(true)
    setError(null)
    try {
      const host = await pairFromOffer({ offer, name, model: Device.modelName ?? null, fetch: appFetch, randomBytes })
      await app.addHost(host)
      router.replace({ pathname: '/host/[hostId]', params: { hostId: host.hostId } })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const minutesLeft = offer ? Math.max(0, Math.ceil((offer.expiresAt - now) / 60_000)) : 0

  return (
    <SafeAreaView style={styles.screen} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        {!offer ? (
          <>
            {scanning ? (
              <Scanner onScanned={(data) => void take(data)} />
            ) : (
              <Button label={t('Scan QR code')} onPress={() => setScanning(true)} />
            )}
            <Section title={t('Pairing link')}>
              <TextInput
                style={styles.input}
                value={link}
                onChangeText={(text) => (text.trim() ? take(text) : setLink(text))}
                placeholder="zomfy://pair#…"
                placeholderTextColor={colors.muted}
                autoCapitalize="none"
                autoCorrect={false}
              />
              <Button label={t('Paste link')} onPress={() => void paste()} />
            </Section>
          </>
        ) : (
          <View style={styles.card}>
            <Text style={[styles.text, { fontSize: 17, fontWeight: '600' }]}>{t('Host {host}', { host: offer.hostName })}</Text>
            <Text style={styles.muted}>{t('Expires in {minutes} min', { minutes: minutesLeft })}</Text>
            {offer.routes.map((route) => (
              <Text key={route.url} style={styles.muted}>
                {routeLabel(route)} · {route.url}
              </Text>
            ))}
            <Section title={t('Phone name')}>
              <TextInput style={styles.input} value={name} onChangeText={setName} placeholderTextColor={colors.muted} />
            </Section>
            <Button label={busy ? t('Pairing…') : t('Pair this phone')} kind="primary" busy={busy} onPress={() => void pair()} />
            <Button
              label={t('Cancel')}
              onPress={() => {
                setOffer(null)
                setLink('')
              }}
            />
          </View>
        )}
        {error ? <Text style={styles.error}>{t(error)}</Text> : null}
      </ScrollView>
    </SafeAreaView>
  )
}
