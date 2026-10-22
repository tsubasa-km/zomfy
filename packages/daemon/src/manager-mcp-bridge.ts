// `--mcp-bridge <url>`: a stdio MCP server for agents whose ACP side takes only stdio servers. It
// relays each newline-delimited JSON-RPC message to the daemon's HTTP endpoint and prints the reply.
// Messages are relayed concurrently, so a long wait_for_session does not hold up other calls.

export async function runManagerMcpBridge(url: string): Promise<void> {
  const token = process.env.HARNESS_MCP_TOKEN ?? "";
  const write = (message: unknown) => process.stdout.write(`${JSON.stringify(message)}\n`);

  async function relay(line: string): Promise<void> {
    let id: unknown = null;
    try {
      id = (JSON.parse(line) as { id?: unknown }).id ?? null;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", Authorization: `Bearer ${token}` },
        body: line,
      });
      if (res.status === 202) return;
      const text = await res.text();
      if (!res.ok) {
        if (id !== null) write({ jsonrpc: "2.0", id, error: { code: -32603, message: `acp-harness daemon refused the call (${res.status} ${text})` } });
        return;
      }
      if (text) write(JSON.parse(text));
    } catch (error) {
      if (id !== null) write({ jsonrpc: "2.0", id, error: { code: -32603, message: `acp-harness daemon unreachable: ${String(error)}` } });
    }
  }

  const inFlight = new Set<Promise<void>>();
  let buffered = "";
  const decoder = new TextDecoder();
  for await (const chunk of Bun.stdin.stream()) {
    buffered += decoder.decode(chunk, { stream: true });
    let newline: number;
    while ((newline = buffered.indexOf("\n")) !== -1) {
      const line = buffered.slice(0, newline).trim();
      buffered = buffered.slice(newline + 1);
      if (!line) continue;
      const pending = relay(line).finally(() => inFlight.delete(pending));
      inFlight.add(pending);
    }
  }
  // stdin closed: let answers already asked for arrive before exiting.
  await Promise.all(inFlight);
}
