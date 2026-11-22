// The relay link's channels besides bots (docs/decisions/one-relay-worker.md): the one link the
// connector client owns also carries the `phone` channel. The connector client reports the link
// here; the phone relay listens. Either may come first.

import type { PhoneToHost } from '@zomfy/relay-contract'

/** Sends one channel message on the link; false when the link is down. */
export interface RelayLinkPort {
  send(message: object): boolean
}

export interface PhoneChannelListener {
  /** The link authenticated (again): a fresh start for every phone channel. */
  online(port: RelayLinkPort): void
  /** The link dropped: every phone channel is gone. */
  offline(): void
  message(message: PhoneToHost): void
}

export class RelayChannels {
  private port: RelayLinkPort | null = null
  private listener: PhoneChannelListener | null = null

  /** The phone relay; told at once when the link is already up. */
  setPhone(listener: PhoneChannelListener | null): void {
    this.listener = listener
    if (listener && this.port) listener.online(this.port)
  }

  linkOnline(port: RelayLinkPort): void {
    this.port = port
    this.listener?.online(port)
  }

  linkOffline(): void {
    if (!this.port) return
    this.port = null
    this.listener?.offline()
  }

  phoneMessage(message: PhoneToHost): void {
    if (this.port) this.listener?.message(message)
  }

  get online(): boolean {
    return this.port !== null
  }
}

/** The daemon's one set of channels: the connector client and the phone relay meet here. */
export const relayChannels = new RelayChannels()
