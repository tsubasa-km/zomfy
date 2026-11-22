import type { ReactNode } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native'
import { router, usePathname } from 'expo-router'
import type { RemoteRoute, SessionStatus } from '@zomfy/protocol'
import type { ConnectionStatus } from '../lib/host-connection'
import { useNeedsYouTotal } from './hooks'
import { t } from './i18n'
import { colors, space, statusColors } from './theme'

export function Button(props: {
  label: string
  onPress: () => void
  kind?: 'primary' | 'secondary' | 'danger'
  disabled?: boolean
  busy?: boolean
  style?: StyleProp<ViewStyle>
}) {
  const kind = props.kind ?? 'secondary'
  return (
    <Pressable
      accessibilityRole="button"
      disabled={props.disabled || props.busy}
      onPress={props.onPress}
      style={({ pressed }) => [
        styles.button,
        kind === 'primary' && styles.buttonPrimary,
        kind === 'danger' && styles.buttonDanger,
        (props.disabled || props.busy) && styles.buttonDisabled,
        pressed && styles.buttonPressed,
        props.style
      ]}
    >
      {props.busy ? (
        <ActivityIndicator color={kind === 'primary' ? colors.accentText : colors.text} />
      ) : (
        <Text style={[styles.buttonText, kind === 'primary' && styles.buttonTextPrimary]}>{props.label}</Text>
      )}
    </Pressable>
  )
}

export function StatusDot({ status }: { status: SessionStatus }) {
  return <View style={[styles.dot, { backgroundColor: statusColors[status] }]} />
}

export const statusLabel = (status: SessionStatus): string =>
  status === 'needs-you' ? t('Needs you') : status === 'working' ? t('Working') : status === 'error' ? t('Error') : t('Idle')

export const routeLabel = (route: RemoteRoute | null): string =>
  route?.kind === 'lan' ? t('Wi-Fi') : route?.kind === 'tailnet' ? t('Tailnet') : route?.kind === 'relay' ? t('Relay') : ''

export function connectionLabel(status: ConnectionStatus | undefined): string {
  switch (status) {
    case 'connected':
      return t('Connected')
    case 'connecting':
      return t('Connecting…')
    case 'unpaired':
      return t('Unpaired')
    case 'stopped':
      return t('Stopped')
    default:
      return t('Offline')
  }
}

export const connectionColor = (status: ConnectionStatus | undefined): string =>
  status === 'connected' ? colors.success : status === 'connecting' ? colors.warning : colors.danger

export function Section({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>{title}</Text>
        {right}
      </View>
      {children}
    </View>
  )
}

export function Empty({ title, body, children }: { title: string; body?: string; children?: ReactNode }) {
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyTitle}>{title}</Text>
      {body ? <Text style={styles.emptyBody}>{body}</Text> : null}
      {children}
    </View>
  )
}

/** Hosts · Needs you · Settings, along the bottom of the three main screens. */
export function TabBar() {
  const pathname = usePathname()
  const count = useNeedsYouTotal()
  const tabs = [
    { path: '/', label: t('Hosts') },
    { path: '/needs-you', label: count > 0 ? `${t('Needs you')} (${count})` : t('Needs you') },
    { path: '/settings', label: t('Settings') }
  ]
  return (
    <View style={styles.tabBar}>
      {tabs.map((tab) => {
        const active = pathname === tab.path
        return (
          <Pressable key={tab.path} style={styles.tab} onPress={() => !active && router.replace(tab.path as never)}>
            <Text style={[styles.tabText, active && styles.tabTextActive]}>{tab.label}</Text>
          </Pressable>
        )
      })}
    </View>
  )
}

export const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  scroll: { padding: space.lg, gap: space.lg },
  text: { color: colors.text, fontSize: 15 },
  muted: { color: colors.muted, fontSize: 13 },
  error: { color: colors.danger, fontSize: 14 },
  card: { backgroundColor: colors.surface, borderRadius: 12, padding: space.md, gap: space.sm, borderWidth: 1, borderColor: colors.border },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  input: {
    backgroundColor: colors.surfaceRaised,
    color: colors.text,
    borderRadius: 10,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    fontSize: 15,
    borderWidth: 1,
    borderColor: colors.border
  },
  button: {
    minHeight: 40,
    paddingHorizontal: space.lg,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.border
  },
  buttonPrimary: { backgroundColor: colors.accent, borderColor: colors.accent },
  buttonDanger: { borderColor: colors.danger },
  buttonDisabled: { opacity: 0.5 },
  buttonPressed: { opacity: 0.75 },
  buttonText: { color: colors.text, fontSize: 15, fontWeight: '600' },
  buttonTextPrimary: { color: colors.accentText },
  dot: { width: 10, height: 10, borderRadius: 5 },
  section: { gap: space.sm },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionTitle: { color: colors.muted, fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.8 },
  empty: { alignItems: 'center', padding: space.xl, gap: space.md },
  emptyTitle: { color: colors.text, fontSize: 18, fontWeight: '600' },
  emptyBody: { color: colors.muted, fontSize: 14, textAlign: 'center' },
  tabBar: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.surface },
  tab: { flex: 1, alignItems: 'center', paddingVertical: space.md },
  tabText: { color: colors.muted, fontSize: 14, fontWeight: '600' },
  tabTextActive: { color: colors.accent }
})
