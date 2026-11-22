import { generateKeyPairSync } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { hostname } from "node:os";
import {
  DEFAULT_REMOTE_PORT,
  DEVICE_SCOPES,
  PAIRING_GRANT_TTL_MS,
  fromBase64Url,
  isDeviceScope,
  toBase64Url,
  type DeviceScope,
  type PairRequest,
  type RemoteDevice,
} from "@zomfy/protocol";
import { HARNESS_HOME } from "./harness-home.ts";
import { replaceFile } from "./replace-file.ts";
import { log } from "./log.ts";

// Paired phones, kept in `~/.zomfy/devices.json` (docs/specs/mobile/pairing.md). A device stays
// paired until revoked: there is no expiry. Pairing grants live in memory only, so a daemon restart
// burns every grant it had offered.

export interface DeviceRecord {
  id: string;
  name: string;
  model: string | null;
  /** Ed25519, base64url raw 32 bytes: verifies each connect's challenge. */
  publicKey: string;
  /** X25519, base64url raw 32 bytes: the relay's end-to-end encryption (M2). */
  boxPublicKey: string;
  scopes: DeviceScope[];
  createdAt: number;
  lastSeenAt: number | null;
}

interface DevicesFile {
  version: 1;
  hostId: string;
  listener: { enabled: boolean; port: number };
  devices: DeviceRecord[];
}

interface Grant {
  expiresAt: number;
  scopes: DeviceScope[];
}

export class PairingError extends Error {}

/** The host's X25519 key, pinned by phones in the pairing offer. Private part stays on disk, mode 0600. */
export interface HostBoxKey {
  publicKey: string;
  /** base64url; only the relay's end-to-end channel reads it. */
  secretKey?: string;
}

export class DeviceStore {
  private file: DevicesFile = { version: 1, hostId: crypto.randomUUID(), listener: { enabled: false, port: DEFAULT_REMOTE_PORT }, devices: [] };
  private readonly grants = new Map<string, Grant>();
  private boxKey: HostBoxKey | null = null;
  private saving: Promise<void> = Promise.resolve();
  private loadedFlag = false;

  constructor(
    private readonly path = join(HARNESS_HOME, "devices.json"),
    private readonly boxKeyPath = join(HARNESS_HOME, "remote", "box-key.json"),
    private readonly now: () => number = Date.now,
  ) {}

  async load(): Promise<void> {
    try {
      const raw = JSON.parse(await readFile(this.path, "utf8")) as Partial<DevicesFile>;
      this.file = {
        version: 1,
        hostId: typeof raw.hostId === "string" ? raw.hostId : this.file.hostId,
        listener: {
          enabled: raw.listener?.enabled === true,
          port: typeof raw.listener?.port === "number" ? raw.listener.port : DEFAULT_REMOTE_PORT,
        },
        devices: Array.isArray(raw.devices) ? raw.devices.filter(validRecord).map((d) => ({ ...d, scopes: d.scopes.filter(isDeviceScope) })) : [],
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") log(`devices: ${this.path} could not be read (${String(error)}); starting with none`);
      await this.save();
    }
    this.boxKey = await this.loadBoxKey();
    this.loadedFlag = true;
  }

  /** `load` finished: the device list is the one on disk, not the empty default. */
  get loaded(): boolean {
    return this.loadedFlag;
  }
  get hostId(): string {
    return this.file.hostId;
  }
  get hostName(): string {
    return hostname();
  }
  get listener(): { enabled: boolean; port: number } {
    return { ...this.file.listener };
  }
  get hostBoxPublicKey(): string {
    return this.boxKey?.publicKey ?? "";
  }
  /** The X25519 secret whose public part phones pinned; empty before `load`. */
  get hostBoxSecretKey(): string {
    return this.boxKey?.secretKey ?? "";
  }

  async setListener(enabled: boolean, port?: number): Promise<void> {
    this.file.listener = { enabled, port: port ?? this.file.listener.port };
    await this.save();
  }

  list(): DeviceRecord[] {
    return this.file.devices.map((d) => ({ ...d, scopes: [...d.scopes] }));
  }

  get(id: string): DeviceRecord | undefined {
    return this.file.devices.find((d) => d.id === id);
  }

  /** A new one-time grant; the default offers every scope (the person's own phone). */
  createGrant(scopes: readonly DeviceScope[] = DEVICE_SCOPES): { grant: string; expiresAt: number; scopes: DeviceScope[] } {
    this.dropExpiredGrants();
    const grant = toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
    const entry: Grant = { expiresAt: this.now() + PAIRING_GRANT_TTL_MS, scopes: scopes.filter(isDeviceScope) };
    this.grants.set(grant, entry);
    return { grant, ...entry, scopes: [...entry.scopes] };
  }

  /**
   * Checks and burns the grant, then records the device. A phone pairing over the relay names its
   * own id (the one the Hub knows it by); otherwise a new one is made.
   */
  async pair(request: PairRequest, id?: string): Promise<DeviceRecord> {
    if (id !== undefined && (!/^[A-Za-z0-9_-]{8,64}$/.test(id) || this.get(id))) throw new PairingError("This phone's id is malformed or taken");
    const grant = typeof request.grant === "string" ? this.grants.get(request.grant) : undefined;
    if (!grant) throw new PairingError("This pairing code was already used or is unknown; show a new QR code");
    this.grants.delete(request.grant);
    if (grant.expiresAt <= this.now()) throw new PairingError("This pairing code expired; show a new QR code");
    if (!isKey(request.publicKey) || !isKey(request.boxPublicKey)) throw new PairingError("The phone's keys are malformed");
    const record: DeviceRecord = {
      id: id ?? crypto.randomUUID(),
      name: typeof request.name === "string" && request.name.trim() ? request.name.trim().slice(0, 80) : "Phone",
      model: typeof request.model === "string" ? request.model.slice(0, 80) : null,
      publicKey: request.publicKey,
      boxPublicKey: request.boxPublicKey,
      scopes: [...grant.scopes],
      createdAt: this.now(),
      lastSeenAt: null,
    };
    this.file.devices.push(record);
    await this.save();
    return record;
  }

  async revoke(id: string): Promise<boolean> {
    const before = this.file.devices.length;
    this.file.devices = this.file.devices.filter((d) => d.id !== id);
    if (this.file.devices.length === before) return false;
    await this.save();
    return true;
  }

  /** Saved at most once a minute per device, so a chatty phone does not rewrite the file. */
  async seen(id: string): Promise<void> {
    const device = this.get(id);
    if (!device) return;
    const now = this.now();
    if (device.lastSeenAt !== null && now - device.lastSeenAt < 60_000) return;
    device.lastSeenAt = now;
    // Only a timestamp: a failed save is logged by save() and retried at the next connect.
    await this.save().catch(() => undefined);
  }

  toPublic(record: DeviceRecord, connected: boolean): RemoteDevice {
    return { id: record.id, name: record.name, model: record.model, scopes: [...record.scopes], createdAt: record.createdAt, lastSeenAt: record.lastSeenAt, connected };
  }

  private dropExpiredGrants(): void {
    const now = this.now();
    for (const [grant, entry] of this.grants) if (entry.expiresAt <= now) this.grants.delete(grant);
  }

  private save(): Promise<void> {
    const next = this.saving.then(async () => {
      await mkdir(dirname(this.path), { recursive: true });
      const temp = `${this.path}.${process.pid}.${crypto.randomUUID()}.tmp`;
      await writeFile(temp, JSON.stringify(this.file, null, 2), { mode: 0o600 });
      await replaceFile(temp, this.path);
    });
    this.saving = next.catch((error) => log(`devices: could not save ${this.path}: ${String(error)}`));
    return next;
  }

  private async loadBoxKey(): Promise<HostBoxKey> {
    try {
      const raw = JSON.parse(await readFile(this.boxKeyPath, "utf8")) as { publicKey?: unknown; privateKey?: unknown };
      if (isKey(raw.publicKey)) return { publicKey: raw.publicKey, ...(isKey(raw.privateKey) ? { secretKey: raw.privateKey } : {}) };
    } catch {
      // Made below.
    }
    const { publicKey, privateKey } = generateKeyPairSync("x25519");
    const pub = publicKey.export({ format: "jwk" }).x!;
    const priv = privateKey.export({ format: "jwk" }).d!;
    await mkdir(dirname(this.boxKeyPath), { recursive: true });
    await writeFile(this.boxKeyPath, JSON.stringify({ publicKey: pub, privateKey: priv }), { mode: 0o600 });
    return { publicKey: pub, secretKey: priv };
  }
}

function isKey(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    return fromBase64Url(value).length === 32;
  } catch {
    return false;
  }
}

function validRecord(value: unknown): value is DeviceRecord {
  const d = value as Partial<DeviceRecord>;
  return !!d && typeof d.id === "string" && typeof d.publicKey === "string" && typeof d.name === "string" && Array.isArray(d.scopes);
}
