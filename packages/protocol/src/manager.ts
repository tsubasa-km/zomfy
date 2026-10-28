// The manager agent's tools (Orca's orchestration, as MCP tools instead of an `orca` CLI). Each
// daemon serves them over MCP to its own chat agents; a call is routed to a connected desktop
// window, which is the one party linked to every host, and runs there against the target host.

/** Name agents see the tools under (`mcp__harness__list_sessions` in Claude). */
export const MANAGER_MCP_SERVER_NAME = 'harness'

/** Set in `clientCapabilities._meta` by windows that run manager calls; older windows lack it. */
export const MANAGER_ROUTING_CAPABILITY = 'harness/managerRouting'

export const MANAGER_METHODS = {
  /** Daemon → window: run one manager tool for the session that called it. */
  managerCall: '_harness/manager/call'
} as const

export interface ManagerCallParams {
  /** The harness session whose agent called the tool. */
  callerSessionId: string
  tool: ManagerToolName
  args: Record<string, unknown>
}

/** JSON-able result; the daemon hands it to the agent as text. */
export interface ManagerCallResult {
  result: unknown
  isError?: boolean
}

export interface ManagerRequests {
  [MANAGER_METHODS.managerCall]: { params: ManagerCallParams; result: ManagerCallResult }
}

/** 'manager': across every project. 'lead' is kept only for chats older daemons made; it now means nothing. */
export type SessionRole = 'manager' | 'lead'

/** What a session reads as across hosts: `unverifiable` when its host is out of contact. */
export type ManagedSessionStatus = 'idle' | 'working' | 'needs-you' | 'error' | 'unverifiable'

interface JsonSchemaObject {
  type: 'object'
  properties: Record<string, unknown>
  required?: string[]
}

export interface ManagerToolDefinition {
  name: string
  description: string
  inputSchema: JsonSchemaObject
  /** Only reads or waits: auto-allowed without asking the person. */
  readOnly: boolean
  /** Part of the manager's job: auto-allowed in a Manager session, asked elsewhere. */
  managerAllowed?: boolean
  /** Changes only where the calling chat runs: auto-allowed in every chat. */
  selfOnly?: boolean
  /** Offered only to a workflow step's session, and served by the daemon running the step. */
  stepOnly?: boolean
}

const str = (description: string) => ({ type: 'string', description })

export const MANAGER_TOOLS = [
  {
    name: 'list_hosts',
    description:
      'Hosts this harness is linked to (this computer, WSL distros, SSH hosts) with their connection state. A host out of contact is "unverifiable": its agents may still be running.',
    inputSchema: { type: 'object', properties: {} },
    readOnly: true
  },
  {
    name: 'list_workspaces',
    description:
      'Projects and their workspaces (git worktrees or folders) on every connected host, with ids, paths, branches and how many sessions each has.',
    inputSchema: { type: 'object', properties: { hostId: str('Only this host (from list_hosts).') } },
    readOnly: true
  },
  {
    name: 'list_sessions',
    description:
      'Agent chat sessions across hosts with their status (idle, working, needs-you, error, unverifiable), workspace, agent, whether the person has not seen the latest result, and pending approvals.',
    inputSchema: {
      type: 'object',
      properties: {
        hostId: str('Only this host.'),
        workspaceId: str('Only this workspace.'),
        status: str('Only sessions with this status.')
      }
    },
    readOnly: true
  },
  {
    name: 'read_session',
    description: "A session's recent transcript: user prompts, agent replies, tool calls and approvals, newest last.",
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: str('Session to read.'),
        limit: { type: 'number', description: 'Most recent items to return (default 20, max 100).' }
      },
      required: ['sessionId']
    },
    readOnly: true
  },
  {
    name: 'send_prompt',
    description:
      'Sends a prompt to another session and returns at once; use wait_for_session for the result. Fails while that session is still working.',
    inputSchema: {
      type: 'object',
      properties: { sessionId: str('Target session.'), text: str('The prompt.') },
      required: ['sessionId', 'text']
    },
    readOnly: false,
    managerAllowed: true
  },
  {
    name: 'create_session',
    description:
      'Starts a new agent chat in an existing workspace (any host), optionally with a first prompt. For folder projects, use the project\'s primary workspace.',
    inputSchema: {
      type: 'object',
      properties: {
        workspaceId: str('Workspace to start in (from list_workspaces).'),
        agent: str('Agent id: claude (default), codex, gemini, opencode…'),
        prompt: str('First prompt; omit to start idle.')
      },
      required: ['workspaceId']
    },
    readOnly: false,
    managerAllowed: true
  },
  {
    name: 'create_workspace',
    description:
      'Creates a new git worktree workspace in a project (on that project\'s host) and starts an agent in it with a prompt. Only for git projects; reuse an existing workspace unless isolation is needed.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: str('Project (from list_workspaces).'),
        name: str('Workspace name; also names the branch.'),
        baseRef: str("Ref to branch from; defaults to the project's base."),
        agent: str('Agent id; defaults to claude.'),
        prompt: str('First prompt for the agent.')
      },
      required: ['projectId', 'name']
    },
    readOnly: false,
    managerAllowed: true
  },
  {
    name: 'move_chat',
    description:
      "Moves THIS chat into another workspace on its host so you work in that folder: an existing workspace, a folder (added as a project when it is not one yet), or a new git worktree of a project. Use it when the task belongs somewhere other than the chat's current folder, e.g. a quick chat started in a scratch folder. The move happens when your current turn ends and the conversation then continues there by itself, so end your turn right after calling it with one short line. Give exactly one of workspaceId, folder or newWorktree.",
    inputSchema: {
      type: 'object',
      properties: {
        workspaceId: str('Existing workspace on this host (from list_workspaces).'),
        folder: str('Absolute folder path on this host.'),
        newWorktree: {
          type: 'object',
          description: "New git worktree for parallel work on a branch.",
          properties: { projectId: str('Git project (from list_workspaces).'), name: str('Workspace and branch name.') },
          required: ['projectId', 'name']
        }
      }
    },
    readOnly: false,
    managerAllowed: true,
    selfOnly: true
  },
  {
    name: 'wait_for_session',
    description:
      'Waits until any of the sessions stops working (finished, needs the person, failed) or the timeout passes, then reports each one\'s status and last reply. A timeout or "unverifiable" is a checkpoint, not a failure: wait again or inspect.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionIds: { type: 'array', items: { type: 'string' }, description: 'Sessions to wait on.' },
        timeoutSeconds: { type: 'number', description: 'Default 300, max 1800.' }
      },
      required: ['sessionIds']
    },
    readOnly: true
  },
  {
    name: 'list_approvals',
    description: 'Permission requests from agents that are waiting on an answer, across hosts.',
    inputSchema: { type: 'object', properties: { sessionId: str('Only this session.') } },
    readOnly: true
  },
  {
    name: 'answer_approval',
    description:
      'Answers a pending permission request with one of its option ids. The person is asked before this runs; prefer forward_to_person when unsure.',
    inputSchema: {
      type: 'object',
      properties: { requestId: str('From list_approvals.'), optionId: str('One of the request\'s option ids.') },
      required: ['requestId', 'optionId']
    },
    readOnly: false
  },
  {
    name: 'forward_to_person',
    description:
      "Puts a question or task in the person's inbox, optionally linked to a session or workspace. Use it for decisions only the person should make.",
    inputSchema: {
      type: 'object',
      properties: {
        text: str('What the person needs to do or decide.'),
        sessionId: str('Session it is about.'),
        workspaceId: str('Workspace it is about.')
      },
      required: ['text']
    },
    readOnly: false,
    managerAllowed: true
  },
  {
    name: 'list_todos',
    description: "The person's own todo list and items agents forwarded to them.",
    inputSchema: { type: 'object', properties: { includeDone: { type: 'boolean' } } },
    readOnly: true
  },
  {
    name: 'ask_requester',
    description:
      "In a workflow step: asks the chat that started this run a question and waits for the answer; keep working with it afterwards. Use it when you need a decision or context you cannot find yourself. When that chat cannot decide, or the run was not started from a chat, the question goes to the person and their answer comes back here. Blocks until answered.",
    inputSchema: {
      type: 'object',
      properties: { question: str('The question, with the context needed to answer it.') },
      required: ['question']
    },
    readOnly: false,
    selfOnly: true
  },
  {
    name: 'claim_worktree',
    description:
      "Lets you change another worktree of your project until your turn ends. Every chat working there must be idle; while you hold it they may only read. Prefer asking that worktree's chat with send_prompt when the change is theirs to make.",
    inputSchema: {
      type: 'object',
      properties: { workspaceId: str('The other worktree, as your instructions or list_workspaces give it.') },
      required: ['workspaceId']
    },
    readOnly: false,
    selfOnly: true
  },
  {
    name: 'finish_worktree',
    description:
      "Call when the work in your own worktree is done and committed. It brings it home the way the project is set up: merged into the main checkout, after which this chat moves to the main checkout and the worktree and its branch are removed when your turn ends; or pushed as a pull request, with the worktree kept for follow-ups. Uncommitted changes, a merge conflict or a busy main checkout stop it with what to do; it never discards work or force-pushes (ask the person with forward_to_person for that).",
    inputSchema: {
      type: 'object',
      properties: { title: str('For a pull request: its title; defaults to the latest commit subject.') }
    },
    readOnly: false,
    selfOnly: true
  },
  {
    name: 'spawn_agents',
    description:
      "Runs helper agents on parts of your workflow step and waits for their reports. The step caps how many run at once; the rest queue. They work in your folder at the same time, so give each a self-contained part (goal, files it owns, how to check it) that does not overlap the others'. They do not commit: integrate, verify and commit yourself.",
    inputSchema: {
      type: 'object',
      properties: {
        tasks: {
          type: 'array',
          description: 'One entry per helper agent.',
          items: {
            type: 'object',
            properties: { title: str('A few words naming the part.'), task: str('The part, self-contained.') },
            required: ['task']
          }
        }
      },
      required: ['tasks']
    },
    readOnly: false,
    selfOnly: true,
    stepOnly: true
  },
  {
    name: 'list_workflows',
    description: "This project's saved workflows (graphs of agent steps the harness runs) and their recent runs.",
    inputSchema: { type: 'object', properties: {} },
    readOnly: true
  },
  {
    name: 'run_workflow',
    description:
      "Starts one of this project's workflows on a task; the harness runs its steps (developer, tests, review…) and routes between them. The run shows as a card in this chat; you hear when it waits or ends. Prefer it over hand-made sessions when a workflow fits the task.",
    inputSchema: {
      type: 'object',
      properties: {
        workflowId: str('From list_workflows.'),
        task: str('The task every step works on: goal, scope, constraints, how to verify.')
      },
      required: ['workflowId', 'task']
    },
    readOnly: false,
    managerAllowed: true
  },
  {
    name: 'get_workflow_run',
    description: 'A workflow run: status, the step it is on, each step with its outcome and summary, and what it waits for.',
    inputSchema: { type: 'object', properties: { runId: str('From run_workflow or list_workflows.') }, required: ['runId'] },
    readOnly: true
  }
] as const satisfies readonly ManagerToolDefinition[]

export type ManagerToolName = (typeof MANAGER_TOOLS)[number]['name']

export function isManagerToolName(name: string): name is ManagerToolName {
  return MANAGER_TOOLS.some((t) => t.name === name)
}

/** Appended to Claude's system prompt in a Manager session. */
export const MANAGER_SYSTEM_PROMPT = `You are the Manager: you coordinate other coding agents across this person's projects and machines (this computer, WSL distros, SSH hosts) through the \`${MANAGER_MCP_SERVER_NAME}\` tools. You do not edit code yourself; you place work, watch it, and report.

How to work:
- Start with list_hosts / list_workspaces / list_sessions to see what exists. Ids are exact; never guess them.
- Prefer an existing workspace and session. Use create_session for a fresh agent in an existing workspace; create_workspace only when work needs its own branch.
- Give each agent a self-contained prompt: target files or area, the change, constraints, and how to verify.
- After send_prompt or create_*, call wait_for_session. A timeout or "unverifiable" (host out of contact) is a checkpoint, not a failure: never assume an agent died. Read its transcript with read_session before deciding.
- When an agent needs the person (status needs-you), list_approvals shows what it asks. Forward decisions to the person with forward_to_person rather than approving risky actions yourself.
- Finish with a short report per task: outcome, evidence (what you read), and anything still waiting on the person.`

/** Appended to Claude's system prompt in a quick chat, which starts in a throwaway folder. */
export const QUICK_CHAT_SYSTEM_PROMPT = `This chat started as a quick chat in a scratch folder the person did not choose, so they need not think about folders. When the request concerns one of their projects or needs a real home (a new app, an existing repository), find it with \`${MANAGER_MCP_SERVER_NAME}\` list_workspaces and call move_chat before working on files, then end your turn; the conversation continues in the new folder by itself. Answer questions that need no project right here.`
