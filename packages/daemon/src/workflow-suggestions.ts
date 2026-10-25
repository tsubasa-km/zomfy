import { query } from "@anthropic-ai/claude-agent-sdk";
import {
  MANAGER_MCP_SERVER_NAME,
  localOnlySteps,
  workflowCycles,
  workflowScorecard,
  type Workflow,
  type WorkflowChange,
  type WorkflowRun,
  type WorkflowSuggestion,
  type WorkflowSuggestions,
} from "@acp-harness/protocol";
import { resolveClaudeExecutable } from "./claude-executable.ts";
import { log } from "./log.ts";

// Proposes changes to a workflow from its last finished runs (reflective prompt evolution, as GEPA
// does it, with the person deciding): one tool-less Claude turn reads the graph and what each step
// did and handed on, and answers with a few changes from a small menu.

const RUNS = 5;
const SUMMARY_CHARS = 700;

function describe(workflow: Workflow): string {
  const nodes = workflow.nodes.map((n) => {
    const c = n.config;
    const parts = [`- node ${n.id} [${n.kind}] "${n.label}"`];
    if (c.role) parts.push(`role: ${c.role}`);
    if (c.profileId) parts.push("uses a defined agent (its own instructions are not shown; the step's are below)");
    if (c.agent) parts.push(`agent: ${c.agent}`);
    if (c.command) parts.push(`command: ${c.command}`);
    if (c.maxRounds) parts.push(`round limit: ${c.maxRounds}`);
    if (c.session) parts.push(`session: ${c.session}`);
    const prompt = c.prompt?.trim() ? `\n  instructions: ${c.prompt.trim()}` : "";
    return `${parts.join("; ")}${prompt}`;
  });
  const label = (id: string) => workflow.nodes.find((n) => n.id === id)?.label ?? id;
  const edges = workflow.edges.map(
    (e) => `- edge ${e.id}: "${label(e.from)}" --${e.outcome}--> "${label(e.to)}"${e.session === "continue" ? " (continues the same chat)" : ""}`,
  );
  const cycles = workflowCycles(workflow).map((c) => `- loop "${c.label}"${c.maxRounds ? ` (limit ${c.maxRounds})` : ""}`);
  return [`Workflow "${workflow.name}"`, "Steps:", ...nodes, "Arrows:", ...edges, ...(cycles.length ? ["Loops:", ...cycles] : [])].join("\n");
}

function describeRun(run: WorkflowRun, index: number): string {
  const card = workflowScorecard(run);
  // What local-only steps learned goes to no cloud model, this one included.
  const withheld = localOnlySteps(run.workflow);
  const head = `Run ${index + 1} (${run.status}): task: ${run.task.slice(0, 400)}`;
  const figures = `scorecard: ${card.steps} steps, ${Math.round(card.durationMs / 1000)}s, tokens in ${card.usage.inputTokens} out ${card.usage.outputTokens}, sent back ${card.sentBack}, checks failed ${card.checksFailed}, files re-read after a handoff ${card.rereadAfterHandoff}/${card.reads}, commands re-run ${card.rerunCommands}/${card.commands}, waited on the person ${card.personWaits}`;
  const steps = run.steps.map((s) => {
    const text = withheld.has(s.nodeId) ? "(withheld: it worked with local-only data)" : s.summary;
    const summary = text.length > SUMMARY_CHARS ? `${text.slice(0, SUMMARY_CHARS)}…` : text;
    return `  · "${s.label}" (node ${s.nodeId}) → ${s.outcome ?? "no outcome"}${s.error ? ` ERROR: ${s.error}` : ""}\n    ${summary.replace(/\n/g, "\n    ")}`;
  });
  const later = (run.followUps ?? []).filter((f) => !withheld.has(f.nodeId)).map((f) => `  left for later by "${f.label}": ${f.text}`);
  // Zomfy's own tools are how steps reach the Lead, not a candidate to take away.
  const context = card.context
    .filter((r) => r.kind !== "agent" && !(r.kind === "mcp" && r.name === MANAGER_MCP_SERVER_NAME))
    .map((r) => `  ${r.kind} ${r.name}: ${r.tokens} tokens in each turn of ${r.loadedIn} step(s), ${r.used === null ? "read, not called" : `used ${r.used} time(s)`}`);
  const held = [...new Set(run.steps.map((s) => s.nodeId))].flatMap((nodeId) => {
    const skills = run.steps.filter((s) => s.nodeId === nodeId).flatMap((s) => (s.context?.items ?? []).filter((i) => i.kind === "skill").map((i) => i.name));
    return skills.length ? [`  node ${nodeId} had skills: ${[...new Set(skills)].join(", ")}`] : [];
  });
  return [head, figures, ...steps, ...later, ...(context.length ? ["  context of its Claude steps:", ...context, ...held] : [])].join("\n");
}

const INSTRUCTIONS = `You improve an agent workflow from the evidence of its runs. The harness walks the graph: each step is an agent session (or a command, or the person) that ends in an outcome, and the arrow with that outcome picks the next step. Steps hand on a written summary unless an arrow continues the same chat.

Propose at most 4 changes, only where the runs show a concrete problem: work sent back for something an earlier step knew, the same failure repeated, files re-read or commands re-run after a handoff, a loop going round without progress, a step whose instructions it ignored, or a skill or MCP server that takes many tokens in every turn yet no run used. Prefer removing friction over adding steps: a sharper instruction, an arrow that continues the chat where a handoff lost what mattered, a tighter or looser round limit, a context item taken away. Do not invent problems the runs do not show; with too little evidence, propose nothing and say what to run next. Taking away something a run used is a regression: never propose it.

Each change is exactly one of:
- {"type":"prompt","nodeId":"…","prompt":"the step's full new instructions"} (rewrite, keeping what works)
- {"type":"maxRounds","nodeId":"…","maxRounds": number or null} (review or check steps only; null means no limit)
- {"type":"continue","edgeId":"…","on": true or false} (only between two agent steps run by one session on the same agent)
- {"type":"removeSkill","nodeId":"…","skill":"…"} (a skill the step had and no run used)
- {"type":"removeMcp","nodeId":"…","server":"…"} (an MCP server whose tools no run called)

Answer with one JSON object and nothing else:
{"assessment":"two or three sentences on how the flow does and where it loses time or information","suggestions":[{"title":"short","reason":"what in which runs shows it","change":{…}}]}`;

/** Changes the runs argue for, checked against the workflow so each names a real step or arrow. */
export async function suggestWorkflowChanges(workflow: Workflow, runs: WorkflowRun[]): Promise<WorkflowSuggestions> {
  const finished = runs
    .filter((r) => r.workflowId === workflow.id && r.status !== "running" && r.status !== "waiting")
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, RUNS);
  if (finished.length === 0) throw new Error("Run the workflow at least once first; suggestions come from its runs.");
  const prompt = [INSTRUCTIONS, "", describe(workflow), "", "Runs, newest first (each against the workflow as it was then):", ...finished.map(describeRun)].join("\n");
  const stream = query({
    prompt,
    options: {
      pathToClaudeCodeExecutable: await resolveClaudeExecutable(),
      tools: [],
      maxTurns: 1,
      persistSession: false,
      settingSources: [],
      stderr: (line) => log(`[workflow-suggest] ${line}`),
    },
  });
  let text = "";
  for await (const message of stream) {
    if (message.type !== "result") continue;
    if (message.subtype !== "success") throw new Error(`Claude could not suggest changes (${message.subtype}).`);
    text = message.result;
  }
  const parsed = parseSuggestions(lastJson(text), workflow, finished);
  return { ...parsed, runIds: finished.map((r) => r.id) };
}

function lastJson(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

function parseSuggestions(value: unknown, workflow: Workflow, runs: WorkflowRun[]): Omit<WorkflowSuggestions, "runIds"> {
  const record = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const assessment = typeof record.assessment === "string" ? record.assessment : "";
  const list = Array.isArray(record.suggestions) ? record.suggestions : [];
  const suggestions = list.flatMap((item: unknown): WorkflowSuggestion[] => {
    const s = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
    const change = checkedChange(s.change, workflow, runs);
    if (!change || typeof s.title !== "string") return [];
    return [{ id: crypto.randomUUID(), title: s.title, reason: typeof s.reason === "string" ? s.reason : "", change }];
  });
  if (!assessment && suggestions.length === 0) throw new Error("Claude's answer could not be read; try again.");
  return { assessment, suggestions };
}

function checkedChange(value: unknown, workflow: Workflow, runs: WorkflowRun[]): WorkflowChange | null {
  const c = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const node = typeof c.nodeId === "string" ? workflow.nodes.find((n) => n.id === c.nodeId) : undefined;
  if (c.type === "prompt" && node && typeof c.prompt === "string" && c.prompt.trim()) {
    return { type: "prompt", nodeId: node.id, prompt: c.prompt.trim() };
  }
  if (c.type === "maxRounds" && node && (node.kind === "review" || node.kind === "check")) {
    const rounds = typeof c.maxRounds === "number" && c.maxRounds >= 1 ? Math.min(50, Math.round(c.maxRounds)) : null;
    return { type: "maxRounds", nodeId: node.id, maxRounds: rounds };
  }
  const edge = typeof c.edgeId === "string" ? workflow.edges.find((e) => e.id === c.edgeId) : undefined;
  if (c.type === "continue" && edge && typeof c.on === "boolean") return { type: "continue", edgeId: edge.id, on: c.on };
  // A step using a defined agent takes its tools from the agent: the change would not hold.
  const ownTools = node && !node.config.profileId && node.kind !== "check" && node.kind !== "human";
  if (c.type === "removeMcp" && ownTools && typeof c.server === "string" && c.server.trim() && c.server.trim() !== MANAGER_MCP_SERVER_NAME) {
    return { type: "denyMcp", nodeId: node.id, server: c.server.trim() };
  }
  if (c.type === "removeSkill" && ownTools && typeof c.skill === "string") {
    // A step is shown a list of skills: the one it has, else the ones its last run recorded.
    const recorded = runs
      .flatMap((r) => r.steps.filter((s) => s.nodeId === node.id).map((s) => s.context?.items ?? []))
      .find((items) => items.some((i) => i.kind === "skill"));
    const had = node.config.tools?.skills ?? recorded?.filter((i) => i.kind === "skill").map((i) => i.name);
    if (!had?.includes(c.skill)) return null;
    return { type: "skills", nodeId: node.id, skills: had.filter((s) => s !== c.skill), removed: c.skill };
  }
  return null;
}
