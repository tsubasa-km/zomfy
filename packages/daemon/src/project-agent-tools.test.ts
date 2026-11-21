import { describe, expect, test } from "bun:test";
import type { Project } from "@acp-harness/protocol";
import { managerMcp } from "./manager-mcp-server.ts";
import { projectToolRefusal, projectToolsOffNote } from "./project-agent-tools.ts";

const project = (patch: Partial<Project> = {}): Project => ({ id: "p1", name: "app", path: "/repo/app", kind: "git", ...patch });

describe("project agent tool settings", () => {
  test("unset settings keep every tool on", () => {
    expect(projectToolRefusal(project(), "run_workflow")).toBeNull();
    expect(projectToolRefusal(project(), "split_work")).toBeNull();
    expect(projectToolRefusal(null, "split_work")).toBeNull();
    expect(projectToolsOffNote(project())).toBeNull();
  });

  test("a setting turned off refuses only its own tool, and says where to turn it on", () => {
    const off = project({ agentSplitWork: false });
    expect(projectToolRefusal(off, "run_workflow")).toBeNull();
    expect(projectToolRefusal(off, "split_work")).toContain("Agents can split work into parallel worktrees");
    expect(projectToolsOffNote(off)).toContain("split_work");
    expect(projectToolsOffNote(off)).not.toContain("run_workflow");
    expect(projectToolsOffNote(project({ agentWorkflows: false, agentSplitWork: false }))).toContain("run_workflow) or split work");
  });

  test("the harness MCP server leaves a refused tool out and answers a call to it with the reason", async () => {
    managerMcp.setBaseUrl("http://127.0.0.1:1");
    const calls: string[] = [];
    managerMcp.setRoute(async (_caller, tool) => {
      calls.push(tool);
      return { result: "ran" };
    });
    const settings = project({ agentWorkflows: false });
    managerMcp.setToolRefusal((sessionId, tool) => (sessionId === "s-off" ? projectToolRefusal(settings, tool) : null));
    const rpc = async (sessionId: string, method: string, params: object = {}) => {
      const { token } = managerMcp.endpointFor(sessionId)!;
      const res = await managerMcp.handleHttp(
        new Request("http://127.0.0.1:1/mcp", {
          method: "POST",
          headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        }),
      );
      return ((await res.json()) as { result: Record<string, unknown> }).result;
    };
    const names = async (sessionId: string) => ((await rpc(sessionId, "tools/list")).tools as { name: string }[]).map((t) => t.name);
    try {
      expect(await names("s-on")).toContain("run_workflow");
      expect(await names("s-off")).not.toContain("run_workflow");
      expect(await names("s-off")).toContain("list_workflows");

      const refused = await rpc("s-off", "tools/call", { name: "run_workflow", arguments: { workflowId: "w", task: "t" } });
      expect(refused.isError).toBe(true);
      expect(JSON.stringify(refused.content)).toContain("Agents can start workflows");
      expect(calls).toEqual([]);

      await rpc("s-on", "tools/call", { name: "run_workflow", arguments: { workflowId: "w", task: "t" } });
      expect(calls).toEqual(["run_workflow"]);
    } finally {
      managerMcp.setToolRefusal(() => null);
      managerMcp.forgetSession("s-on");
      managerMcp.forgetSession("s-off");
    }
  });
});
