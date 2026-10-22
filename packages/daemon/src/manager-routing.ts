import type * as acp from "@agentclientprotocol/sdk";
import {
  MANAGER_METHODS,
  MANAGER_ROUTING_CAPABILITY,
  MANAGER_TOOLS,
  type ManagerCallParams,
  type ManagerCallResult,
  type SessionRole,
} from "@acp-harness/protocol";
import type { ManagerRoute } from "./manager-mcp-server.ts";

// Manager calls run in a desktop window, not here: the window is the one party linked to every
// host (it holds each daemon's token and the SSH tunnels), so a manager on this computer reaches
// WSL and SSH sessions without daemons knowing about each other.

export class ManagerRouting {
  /** Windows that said they run manager calls, oldest first. */
  private readonly capable = new Set<acp.AgentContext>();
  /** The window that started each session's current turn; it is the one the person is watching. */
  private readonly turnClients = new Map<string, acp.AgentContext>();

  noteInitialize(client: acp.AgentContext, params: acp.InitializeRequest): void {
    if (params.clientCapabilities?._meta?.[MANAGER_ROUTING_CAPABILITY] === true) this.capable.add(client);
  }

  forgetClient(client: acp.AgentContext): void {
    this.capable.delete(client);
    for (const [sessionId, c] of this.turnClients) if (c === client) this.turnClients.delete(sessionId);
  }

  noteTurn(sessionId: string, client: acp.AgentContext): void {
    this.turnClients.set(sessionId, client);
  }

  forgetSession(sessionId: string): void {
    this.turnClients.delete(sessionId);
  }

  readonly route: ManagerRoute = async (callerSessionId, tool, args) => {
    const preferred = this.turnClients.get(callerSessionId);
    const client = preferred && this.capable.has(preferred) ? preferred : [...this.capable].at(-1);
    if (!client) {
      return { result: "No acp-harness window is open to carry this call to the other hosts. Ask the person to open the app.", isError: true };
    }
    const params: ManagerCallParams = { callerSessionId, tool, args };
    return client.request<ManagerCallResult, ManagerCallParams>(MANAGER_METHODS.managerCall, params);
  };
}

/** Claude tools that run without asking: reads and the chat's own moves always, the manager's job in a Manager chat. */
export function autoAllowedManagerTools(role: SessionRole | undefined, serverName: string): string[] {
  return MANAGER_TOOLS.filter(
    (t) => t.readOnly || ("selfOnly" in t && t.selfOnly) || (role === "manager" && "managerAllowed" in t && t.managerAllowed),
  ).map(
    (t) => `mcp__${serverName}__${t.name}`,
  );
}
