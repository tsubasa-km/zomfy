import type * as acp from "@agentclientprotocol/sdk";

// The ACP SDK hands each request handler a fresh `ctx.client` object, so it never equals the
// `connection.client` seen when the window connected. Anything keyed by the window (whether it
// closed, whether it runs manager calls) has to go through the one client its connection made.
// Both share the connection's context (`cx`), which is what this keys on.

type Keyed = { readonly cx?: object };

function connectionKey(client: acp.AgentContext): object {
  return (client as unknown as Keyed).cx ?? client;
}

export class ConnectionClients {
  private readonly byConnection = new WeakMap<object, acp.AgentContext>();

  /** Called when a window connects, with the client its connection made. */
  add(client: acp.AgentContext): void {
    this.byConnection.set(connectionKey(client), client);
  }

  delete(client: acp.AgentContext): void {
    this.byConnection.delete(connectionKey(client));
  }

  /** The connection's own client for any client of that connection (a request's `ctx.client`). */
  canonical(client: acp.AgentContext): acp.AgentContext {
    return this.byConnection.get(connectionKey(client)) ?? client;
  }
}
