import { REMOTE_DEVICE_METHODS, isDeviceScope } from "@zomfy/protocol";
import type { RemoteGateway } from "../remote-gateway.ts";
import type { Handle } from "./handler-context.ts";
import { log } from "../log.ts";

/** Settings → Devices. `listen` is false for a stdio daemon, which never opens the listener on its own. */
export function registerRemoteDeviceHandlers(handle: Handle, gateway: RemoteGateway, listen: boolean): void {
  const ready = gateway.load(listen).catch((error) => log(`remote gateway failed to start: ${String(error)}`));

  handle(REMOTE_DEVICE_METHODS.devicesList, async () => {
    await ready;
    return gateway.snapshot();
  });
  handle(REMOTE_DEVICE_METHODS.devicesOffer, async (p) => {
    await ready;
    return gateway.offer(Array.isArray(p.scopes) ? p.scopes.filter(isDeviceScope) : undefined);
  });
  handle(REMOTE_DEVICE_METHODS.devicesRevoke, async (p) => {
    await ready;
    return gateway.revoke(String(p.deviceId));
  });
  handle(REMOTE_DEVICE_METHODS.devicesSetListener, async (p) => {
    await ready;
    return gateway.setListener(p.enabled === true, typeof p.port === "number" ? p.port : undefined);
  });
}
