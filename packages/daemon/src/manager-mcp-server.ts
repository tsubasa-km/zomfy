import type * as acp from "@agentclientprotocol/sdk";
import {
  MANAGER_MCP_SERVER_NAME,
  MANAGER_TOOLS,
  isManagerToolName,
  type ManagerCallResult,
  type ManagerToolName,
} from "@acp-harness/protocol";
import { log } from "./log.ts";

// The manager tools as a Streamable HTTP MCP server on the daemon's own port (POST /mcp/harness,
// JSON responses only, no SSE stream). Each chat session gets its own bearer token, so a call
// knows which session made it; the call itself is routed to a desktop window (see harness-agent).

export const MANAGER_MCP_PATH = `/mcp/${MANAGER_MCP_SERVER_NAME}`;
const PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];
/** Agents' MCP clients time calls out; wait_for_session stays under this. */
export const MANAGER_TOOL_TIMEOUT_MS = 35 * 60_000;

export type ManagerRoute = (
  callerSessionId: string,
  tool: ManagerToolName,
  args: Record<string, unknown>,
) => Promise<ManagerCallResult>;

interface JsonRpcMessage {
  jsonrpc: "2.0";
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

class ManagerMcpServer {
  private baseUrl: string | null = null;
  private route: ManagerRoute | null = null;
  private readonly tokens = new Map<string, string>();
  private readonly tokenBySession = new Map<string, string>();

  /** Set once the daemon listens; without it (stdio mode) no session gets the tools. */
  setBaseUrl(url: string): void {
    this.baseUrl = url;
  }

  setRoute(route: ManagerRoute): void {
    this.route = route;
  }

  /** Where a session's agent reaches the tools, with its own token; null when not served. */
  endpointFor(sessionId: string): { url: string; token: string } | null {
    if (!this.baseUrl) return null;
    let token = this.tokenBySession.get(sessionId);
    if (!token) {
      token = Buffer.from(crypto.getRandomValues(new Uint8Array(24))).toString("hex");
      this.tokenBySession.set(sessionId, token);
      this.tokens.set(token, sessionId);
    }
    return { url: `${this.baseUrl}${MANAGER_MCP_PATH}`, token };
  }

  /** Claude Agent SDK `mcpServers` entry; a Manager chat loads the tools up front instead of via tool search. */
  claudeServers(
    sessionId: string,
    alwaysLoad = false,
  ): Record<string, { type: "http"; url: string; headers: Record<string, string>; timeout: number; alwaysLoad: boolean }> {
    const endpoint = this.endpointFor(sessionId);
    if (!endpoint) return {};
    return {
      [MANAGER_MCP_SERVER_NAME]: {
        type: "http",
        url: endpoint.url,
        headers: { Authorization: `Bearer ${endpoint.token}` },
        timeout: MANAGER_TOOL_TIMEOUT_MS,
        alwaysLoad,
      },
    };
  }

  /** ACP `session/new` entry: HTTP when the agent takes it, else a stdio bridge to the same endpoint. */
  acpServers(sessionId: string, capabilities: acp.AgentCapabilities): acp.McpServer[] {
    const endpoint = this.endpointFor(sessionId);
    if (!endpoint) return [];
    if (capabilities.mcpCapabilities?.http) {
      return [
        {
          type: "http",
          name: MANAGER_MCP_SERVER_NAME,
          url: endpoint.url,
          headers: [{ name: "Authorization", value: `Bearer ${endpoint.token}` }],
        },
      ];
    }
    return [
      {
        name: MANAGER_MCP_SERVER_NAME,
        command: process.execPath,
        args: [...daemonEntryArgs(), "--mcp-bridge", endpoint.url],
        env: [{ name: "HARNESS_MCP_TOKEN", value: endpoint.token }],
      },
    ];
  }

  forgetSession(sessionId: string): void {
    const token = this.tokenBySession.get(sessionId);
    if (!token) return;
    this.tokenBySession.delete(sessionId);
    this.tokens.delete(token);
  }

  async handleHttp(req: Request): Promise<Response> {
    const auth = req.headers.get("authorization") ?? "";
    const sessionId = this.tokens.get(auth.replace(/^Bearer\s+/i, ""));
    if (!sessionId) return new Response("unauthorized", { status: 401 });
    if (req.method === "DELETE") return new Response(null, { status: 200 });
    // No server-initiated stream: the spec lets a server refuse GET with 405.
    if (req.method !== "POST") return new Response("method not allowed", { status: 405, headers: { Allow: "POST" } });

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return Response.json(rpcError(null, -32700, "Parse error"), { status: 400 });
    }
    const messages = (Array.isArray(body) ? body : [body]) as JsonRpcMessage[];
    const replies = (await Promise.all(messages.map((m) => this.handleMessage(sessionId, m)))).filter(
      (r): r is object => r !== null,
    );
    if (replies.length === 0) return new Response(null, { status: 202 });
    return Response.json(Array.isArray(body) ? replies : replies[0]);
  }

  private async handleMessage(sessionId: string, message: JsonRpcMessage): Promise<object | null> {
    // Notifications and responses carry no id and get no reply.
    if (message.id === undefined || message.id === null || !message.method) return null;
    const id = message.id;
    switch (message.method) {
      case "initialize": {
        const asked = String(message.params?.protocolVersion ?? "");
        return rpcResult(id, {
          protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "acp-harness-manager", version: "0.0.1" },
          instructions:
            "Tools to see and drive agent sessions across this person's hosts and projects. Ids come from the list_* tools.",
        });
      }
      case "ping":
        return rpcResult(id, {});
      case "tools/list":
        return rpcResult(id, {
          tools: MANAGER_TOOLS.map((t) => ({
            name: t.name,
            description: t.description,
            inputSchema: t.inputSchema,
            annotations: { readOnlyHint: t.readOnly },
          })),
        });
      case "tools/call":
        return rpcResult(id, await this.callTool(sessionId, message.params ?? {}));
      default:
        return rpcError(id, -32601, `Method not found: ${message.method}`);
    }
  }

  private async callTool(sessionId: string, params: Record<string, unknown>): Promise<object> {
    const name = String(params.name ?? "");
    const args = (typeof params.arguments === "object" && params.arguments !== null ? params.arguments : {}) as Record<string, unknown>;
    if (!isManagerToolName(name)) return toolText(`Unknown tool ${name}`, true);
    if (!this.route) return toolText("Manager tools are not available on this daemon.", true);
    try {
      const { result, isError } = await this.route(sessionId, name, args);
      return toolText(typeof result === "string" ? result : JSON.stringify(result, null, 2), isError);
    } catch (error) {
      log(`manager tool ${name} failed: ${String(error)}`);
      return toolText(error instanceof Error ? error.message : String(error), true);
    }
  }
}

function rpcResult(id: string | number, result: unknown): object {
  return { jsonrpc: "2.0", id, result };
}

function rpcError(id: string | number | null, code: number, message: string): object {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

function toolText(text: string, isError = false): object {
  return { content: [{ type: "text", text }], ...(isError ? { isError: true } : {}) };
}

/** How to start this daemon again: a compiled binary is its own entry; under bun, pass the script. */
function daemonEntryArgs(): string[] {
  const exe = process.execPath.replace(/\\/g, "/").split("/").pop()?.toLowerCase() ?? "";
  return exe === "bun" || exe === "bun.exe" ? [Bun.main] : [];
}

export const managerMcp = new ManagerMcpServer();
