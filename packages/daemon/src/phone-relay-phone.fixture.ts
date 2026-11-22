// A test phone for the phone relay tests: the relay socket, the device key check, the end-to-end
// handshake and JSON-RPC inside the channel, as the app does it (apps/mobile/src/lib/relay-client.ts).

import { createPhoneHandshake, decodeBase64, encodeBase64, phoneDeviceProofMessage, toBase64Url, type PhoneChannelAnswer, type PhoneE2EEChannel } from "@zomfy/protocol";
import { deviceSigningText } from "@zomfy/relay-contract";
import { eventually } from "./relay-fake-hub.fixture";

const enc = new TextEncoder();
const random = (n: number) => crypto.getRandomValues(new Uint8Array(n));

export async function deviceKeys() {
  const pair = (await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"])) as CryptoKeyPair;
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  const sign = async (bytes: Uint8Array) => new Uint8Array(await crypto.subtle.sign("Ed25519", pair.privateKey, new Uint8Array(bytes)));
  return { publicKey: toBase64Url(raw), publicKeyStd: encodeBase64(raw), sign };
}

/** A test phone on the relay: the socket, the key check, the end-to-end handshake. */
export class TestPhone {
  readonly answers: unknown[] = [];
  readonly messages: Record<string, unknown>[] = [];
  readonly presence: string[] = [];
  closed: { code: number; reason: string } | null = null;
  channel: PhoneE2EEChannel | null = null;
  /** The host's ready did not verify against the pinned key. */
  refused = false;
  /** A host frame did not open. */
  broken = false;
  private handshake: ReturnType<typeof createPhoneHandshake> | null = null;
  private ws!: WebSocket;
  private nextId = 1;
  private readonly pending = new Map<number, (message: Record<string, unknown>) => void>();

  constructor(
    private readonly url: string,
    private readonly hostId: string,
    private readonly hostBoxKey: string,
    readonly relayId: string,
    private readonly keys: Awaited<ReturnType<typeof deviceKeys>>,
  ) {}

  async connect(pairing = false): Promise<void> {
    this.ws = new WebSocket(`${this.url.replace(/^http/, "ws")}/v1/device/${this.hostId}/ws`);
    this.ws.onclose = (event) => (this.closed = { code: event.code, reason: event.reason });
    await new Promise<void>((resolve, reject) => {
      this.ws.onmessage = async (event) => {
        const frame = JSON.parse(String(event.data)) as { type: string; nonce?: string; data?: string };
        if (frame.type === "challenge") {
          const signature = encodeBase64(await this.keys.sign(enc.encode(deviceSigningText(this.relayId, frame.nonce!))));
          this.ws.send(JSON.stringify(pairing ? { type: "pair", deviceId: this.relayId, publicKey: this.keys.publicKeyStd, signature } : { type: "auth", deviceId: this.relayId, signature }));
        } else if (frame.type === "host-online") {
          this.presence.push("host-online");
          this.startHandshake();
          resolve();
        } else if (frame.type === "host-offline") this.presence.push("host-offline");
        else if (frame.type === "frame") this.onFrame(frame.data!);
      };
      setTimeout(() => reject(new Error(`no host-online; closed ${JSON.stringify(this.closed)}`)), 3000);
    });
  }

  private startHandshake(): void {
    this.channel = null;
    this.handshake = createPhoneHandshake({ hostPublicKey: this.hostBoxKey, transport: "relay", relayHostId: this.hostId, random });
    this.sendRaw(encodeBase64(enc.encode(JSON.stringify(this.handshake.hello))));
  }

  sendRaw(data: string): void {
    this.ws.send(JSON.stringify({ type: "frame", data }));
  }

  /** The last ciphertext this phone sent, for a replay. */
  lastSent: string | null = null;

  send(text: string): void {
    const data = this.channel!.seal(text);
    this.lastSent = data;
    this.sendRaw(data);
  }

  private onFrame(data: string): void {
    if (!this.channel) {
      const ready = JSON.parse(new TextDecoder().decode(decodeBase64(data)));
      // Null when the ready does not verify (another host's key): no channel, nothing more opens.
      this.channel = this.handshake!.accept(ready);
      this.refused = this.channel === null;
      return;
    }
    const text = this.channel.open(data);
    if (text === null) {
      this.broken = true;
      return;
    }
    const message = JSON.parse(text) as Record<string, unknown>;
    if (this.answers.length === 0 || "type" in message) {
      if ("type" in message) return void this.answers.push(message);
    }
    this.messages.push(message);
    if (typeof message.id === "number" && this.pending.has(message.id)) {
      this.pending.get(message.id)!(message);
      this.pending.delete(message.id);
    }
  }

  async waitChannel(): Promise<void> {
    await eventually(() => this.channel !== null, 3000, "the channel");
  }

  async auth(deviceId: string): Promise<PhoneChannelAnswer> {
    await this.waitChannel();
    const before = this.answers.length;
    const proof = toBase64Url(await this.keys.sign(phoneDeviceProofMessage("auth", this.channel!.transcriptHash)));
    this.send(JSON.stringify({ type: "auth", deviceId, proof }));
    await eventually(() => this.answers.length > before || this.closed !== null, 3000, "the auth answer");
    return this.answers[before] as PhoneChannelAnswer;
  }

  async request(method: string, params: unknown = {}): Promise<Record<string, unknown>> {
    const id = this.nextId++;
    const answer = new Promise<Record<string, unknown>>((resolve) => this.pending.set(id, resolve));
    this.send(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
    return await Promise.race([answer, Bun.sleep(3000).then(() => Promise.reject(new Error(`${method} got no answer`)))]);
  }

  async waitClosed(ms = 2000) {
    await eventually(() => this.closed !== null, ms, "the phone socket to close");
    return this.closed!;
  }

  close() {
    try {
      this.ws.close(1000);
    } catch {}
  }
}
