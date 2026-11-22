import { REMOTE_DEVICE_METHODS, type DeviceScope, type RemoteDevicesSnapshot } from '@zomfy/protocol'
import { harnessRequest } from '@/daemon-connection'
import { LOCAL_HOST } from '@/session-store'
import { createExternalStore } from './external-store'

// Phones paired with this computer's daemon (Settings → Devices, docs/specs/mobile/pairing.md).

const store = createExternalStore<RemoteDevicesSnapshot | null>(null)

/** From `_harness/devices/changed`, and from each request's answer. */
export function setDevicesSnapshot(snapshot: RemoteDevicesSnapshot): void {
  store.set(snapshot)
}

export function useDevicesSnapshot(): RemoteDevicesSnapshot | null {
  return store.use((s) => s)
}

export async function refreshDevices(): Promise<void> {
  setDevicesSnapshot(await harnessRequest(REMOTE_DEVICE_METHODS.devicesList, {}, LOCAL_HOST))
}

export async function setListenerEnabled(enabled: boolean): Promise<void> {
  setDevicesSnapshot(await harnessRequest(REMOTE_DEVICE_METHODS.devicesSetListener, { enabled }, LOCAL_HOST))
}

export async function revokeDevice(deviceId: string): Promise<void> {
  setDevicesSnapshot(await harnessRequest(REMOTE_DEVICE_METHODS.devicesRevoke, { deviceId }, LOCAL_HOST))
}

export function createPairingOffer(scopes?: DeviceScope[]) {
  return harnessRequest(REMOTE_DEVICE_METHODS.devicesOffer, scopes ? { scopes } : {}, LOCAL_HOST)
}
