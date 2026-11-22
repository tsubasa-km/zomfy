// The host side of the phone relay (docs/specs/mobile/relay.md): on the relay link's `phone`
// channel it keeps the Hub's device keys in step with `devices.json`, runs each phone's end-to-end
// handshake, checks the phone's device proof inside the channel, and then hands the decrypted
// stream to the remote gateway, which serves it like a direct socket. A phone pairing over the
// relay presents its grant inside the channel instead.

import {
  answerPhoneHello,
  decodeBase64,
  encodeBase64,
  fromBase64Url,
  phoneDeviceProofMessage,
  type PairRequest,
  type PhoneChannelAnswer,
  type PhoneChannelOpen,
  type PhoneE2EEChannel,
  type RemoteRoute,
} from "@zomfy/protocol";
import { deviceIdSchema, limits, relayDeviceId, type PhoneToHost } from "@zomfy/relay-contract";
import { PairingError, type DeviceStore } from "./device-store.ts";
import type { RelayChannels, PhoneChannelListener, RelayLinkPort } from "./relay-channels.ts";
import type { RelayConfig } from "./relay-pairing.ts";
import type { RelayConnection, RemoteGateway } from "./remote-gateway.ts";

/** JSON-RPC error for a message too large for one relay frame. */
export const RELAY_TOO_LARGE_CODE = -32002;

export interface PhoneRelayDeps {
  gateway: Pick<RemoteGateway, "attachRelay" | "pairDevice" | "notifyChanged">;
  store: Pick<DeviceStore, "list" | "get" | "loaded" | "hostBoxSecretKey">;
  /** The relay this host is paired with, read when needed. */
  relayConfig: () => RelayConfig | null;
  random?: (length: number) => Uint8Array;
  log?: (message: string) => void;
  /** How long a phone may take from device-open to a proven channel. */
  handshakeTimeoutMs?: number;
}

interface Channel {
  relayId: string;
  pairing: boolean;
  state: "hello" | "proof" | "open" | "done";
  e2ee: PhoneE2EEChannel | null;
  connection: RelayConnection | null;
  timer: ReturnType<typeof setTimeout> | null;
}

const decoder = new TextDecoder("utf-8", { fatal: true });

async function verifyEd25519(publicKey: Uint8Array, message: Uint8Array, signature: string): Promise<boolean> {
  try {
    const key = await crypto.subtle.importKey("raw", new Uint8Array(publicKey), { name: "Ed25519" }, false, ["verify"]);
    return await crypto.subtle.verify("Ed25519", key, new Uint8Array(fromBase64Url(signature)), new Uint8Array(message));
  } catch {
    return false;
  }
}

export class PhoneRelay implements PhoneChannelListener {
  private port: RelayLinkPort | null = null;
  private readonly channels = new Map<string, Channel>();
  /** The device list the Hub was last told, to send device-sync only when it changes. */
  private synced: string | null = null;

  constructor(private readonly deps: PhoneRelayDeps) {}

  /** Registers with the link's channels; the link may already be up. */
  attach(channels: RelayChannels): void {
    channels.setPhone(this);
  }

  /** The relay route pairing offers list, while this host is paired with a relay. */
  route(): (RemoteRoute & { online: boolean }) | null {
    const config = this.deps.relayConfig();
    if (!config) return null;
    return { kind: "relay", url: config.relayUrl, relayHostId: config.hostId, online: this.port !== null };
  }

  online(port: RelayLinkPort): void {
    this.closeAll();
    this.port = port;
    this.synced = null;
    this.sync();
    this.deps.gateway.notifyChanged();
  }

  offline(): void {
    this.port = null;
    this.closeAll();
    this.deps.gateway.notifyChanged();
  }

  /** Devices may have changed (Settings → Devices heard something): tell the Hub if they did. */
  devicesChanged(): void {
    this.sync();
  }

  message(message: PhoneToHost): void {
    switch (message.type) {
      case "device-open":
        this.end(message.deviceId);
        this.begin(message.deviceId, message.pairing === true);
        return;
      case "device-closed":
        this.end(message.deviceId);
        return;
      case "frame":
        void this.frame(message.deviceId, message.data);
        return;
    }
  }

  private log(message: string): void {
    this.deps.log?.(`phone relay: ${message}`);
  }

  private sync(): void {
    if (!this.port || !this.deps.store.loaded) return;
    const devices = this.deps.store
      .list()
      .map((d) => ({ deviceId: relayDeviceId(d.id), publicKey: encodeBase64(fromBase64Url(d.publicKey)) }))
      .filter((d) => deviceIdSchema.safeParse(d.deviceId).success)
      .slice(0, limits.maxDevicesPerHost);
    const text = JSON.stringify(devices);
    if (text === this.synced) return;
    if (this.port.send({ ch: "phone", type: "device-sync", devices })) this.synced = text;
  }

  private begin(relayId: string, pairing: boolean): void {
    const channel: Channel = { relayId, pairing, state: "hello", e2ee: null, connection: null, timer: null };
    channel.timer = setTimeout(() => {
      if (channel.state === "hello" || channel.state === "proof") this.fail(channel, limits.closeChannelBroken, "handshake timed out");
    }, this.deps.handshakeTimeoutMs ?? 15_000);
    this.channels.set(relayId, channel);
  }

  /** Forgets a phone's channel; its ACP connection, if any, ends. */
  private end(relayId: string): void {
    const channel = this.channels.get(relayId);
    if (!channel) return;
    this.channels.delete(relayId);
    channel.state = "done";
    if (channel.timer) clearTimeout(channel.timer);
    channel.connection?.closed();
    channel.connection = null;
  }

  private closeAll(): void {
    for (const id of [...this.channels.keys()]) this.end(id);
  }

  /** Ends the channel and asks the Hub to close the phone's socket with `code`. */
  private fail(channel: Channel, code: number, reason: string): void {
    this.log(`closing ${channel.relayId}: ${reason}`);
    this.end(channel.relayId);
    this.port?.send({ ch: "phone", type: "close", deviceId: channel.relayId, code, reason });
  }

  private sendFrame(channel: Channel, data: string): void {
    this.port?.send({ ch: "phone", type: "frame", deviceId: channel.relayId, data });
  }

  private seal(channel: Channel, text: string): void {
    if (!channel.e2ee || channel.state === "done") return;
    // Sized before sealing: a sealed frame that is not sent would leave a gap in the counter.
    const sealedLength = 4 * Math.ceil((24 + 16 + new TextEncoder().encode(text).length) / 3);
    if (sealedLength <= limits.maxMessageBytes - 256) return this.sendFrame(channel, channel.e2ee.seal(text));
    // Over one relay frame: a request gets an error back so the phone does not wait on it.
    let id: unknown;
    try {
      id = (JSON.parse(text) as { id?: unknown }).id;
    } catch {
      // Not JSON-RPC.
    }
    this.log(`dropped a ${text.length}-byte message for ${channel.relayId}: over the relay's frame limit`);
    if (id !== undefined && id !== null) {
      this.sendFrame(channel, channel.e2ee.seal(JSON.stringify({ jsonrpc: "2.0", id, error: { code: RELAY_TOO_LARGE_CODE, message: "Too large to send through the relay" } })));
    }
  }

  private answer(channel: Channel, answer: PhoneChannelAnswer): void {
    this.seal(channel, JSON.stringify(answer));
  }

  private async frame(relayId: string, data: string): Promise<void> {
    const channel = this.channels.get(relayId);
    // A frame with no channel: the phone is ahead of a link that came back; it starts over.
    if (!channel) {
      this.port?.send({ ch: "phone", type: "close", deviceId: relayId, code: limits.closeChannelBroken, reason: "no channel" });
      return;
    }
    if (channel.state === "hello") return this.hello(channel, data);
    const text = channel.e2ee?.open(data) ?? null;
    if (text === null) return this.fail(channel, limits.closeChannelBroken, "a frame did not open (bad, replayed or reordered)");
    if (channel.state === "proof") return this.proof(channel, text);
    if (channel.state === "open") channel.connection?.receive(text);
  }

  private hello(channel: Channel, data: string): void {
    const config = this.deps.relayConfig();
    const secret = this.deps.store.hostBoxSecretKey;
    let value: unknown;
    try {
      value = JSON.parse(decoder.decode(decodeBase64(data)));
    } catch {
      return this.fail(channel, limits.closeChannelBroken, "the hello is not JSON");
    }
    const answer =
      config && secret
        ? answerPhoneHello(value, {
            hostSecretKey: secret,
            transport: "relay",
            relayHostId: config.hostId,
            random: this.deps.random ?? ((n) => crypto.getRandomValues(new Uint8Array(n))),
          })
        : null;
    if (!answer) return this.fail(channel, limits.closeChannelBroken, "the hello is not one this host accepts");
    channel.e2ee = answer.channel;
    channel.state = "proof";
    this.sendFrame(channel, encodeBase64(new TextEncoder().encode(JSON.stringify(answer.ready))));
  }

  private async proof(channel: Channel, text: string): Promise<void> {
    let open: PhoneChannelOpen;
    try {
      open = JSON.parse(text) as PhoneChannelOpen;
    } catch {
      return this.fail(channel, limits.closeChannelBroken, "the first message is not JSON");
    }
    const hash = channel.e2ee!.transcriptHash;
    if (open?.type === "auth" && !channel.pairing && typeof open.deviceId === "string" && typeof open.proof === "string") {
      const device = this.deps.store.get(open.deviceId);
      const ok =
        device &&
        relayDeviceId(device.id) === channel.relayId &&
        (await verifyEd25519(fromBase64Url(device.publicKey), phoneDeviceProofMessage("auth", hash), open.proof));
      if (channel.state !== "proof") return;
      if (!ok || !this.deps.store.get(open.deviceId)) {
        this.answer(channel, { type: "refused", code: limits.closeUnauthorized, message: "This phone is not paired with this host" });
        return this.fail(channel, limits.closeUnauthorized, "device proof failed");
      }
      const attached = this.deps.gateway.attachRelay(device.id, {
        send: (message) => this.seal(channel, message),
        close: (code, reason) => {
          if (channel.state === "done") return;
          this.fail(channel, code, reason || "closed by the host");
        },
      });
      if (!attached) return this.fail(channel, limits.closeUnauthorized, "device gone");
      if (channel.timer) clearTimeout(channel.timer);
      channel.timer = null;
      // `ready` goes out before anything the ACP connection sends.
      this.answer(channel, { type: "ready", scopes: attached.scopes });
      channel.state = "open";
      channel.connection = attached.connection;
      return;
    }
    if (open?.type === "pair" && channel.pairing && typeof open.proof === "string" && open.request && typeof open.request === "object") {
      const request = open.request as PairRequest;
      const ok = typeof request.publicKey === "string" && (await verifyEd25519(fromBase64Url(request.publicKey), phoneDeviceProofMessage("pair", hash), open.proof));
      if (channel.state !== "proof") return;
      if (!ok) {
        this.answer(channel, { type: "refused", code: limits.closeUnauthorized, message: "The phone's key proof did not verify" });
        return this.fail(channel, limits.closeUnauthorized, "pairing proof failed");
      }
      try {
        const response = await this.deps.gateway.pairDevice(request, channel.relayId.slice(2));
        this.answer(channel, { type: "paired", response });
        this.sync();
      } catch (error) {
        this.answer(channel, { type: "refused", code: limits.closeUnauthorized, message: error instanceof PairingError ? error.message : "Pairing failed" });
      }
      // The phone connects again as a device; this channel has done its work.
      if (channel.timer) clearTimeout(channel.timer);
      channel.timer = null;
      channel.state = "done";
      this.channels.delete(channel.relayId);
      return;
    }
    this.answer(channel, { type: "refused", code: limits.closeUnauthorized, message: "Expected auth" });
    this.fail(channel, limits.closeUnauthorized, "expected auth or pair");
  }
}
