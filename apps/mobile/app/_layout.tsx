import { useEffect } from 'react'
import { ActivityIndicator, View } from 'react-native'
import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { app } from '../src/ui/app-model'
import { useObservable } from '../src/ui/hooks'
import { t } from '../src/ui/i18n'
import { colors } from '../src/ui/theme'

export default function RootLayout() {
  const ready = useObservable(app.ready)
  useEffect(() => {
    void app.init()
  }, [])

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      {ready ? (
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: colors.surface },
            headerTintColor: colors.text,
            contentStyle: { backgroundColor: colors.background },
            animation: 'fade'
          }}
        >
          <Stack.Screen name="index" options={{ title: t('Hosts') }} />
          <Stack.Screen name="needs-you" options={{ title: t('Needs you') }} />
          <Stack.Screen name="settings" options={{ title: t('Settings') }} />
          <Stack.Screen name="pair" options={{ title: t('Pair a host') }} />
        </Stack>
      ) : (
        <View style={{ flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={colors.accent} />
        </View>
      )}
    </SafeAreaProvider>
  )
}
