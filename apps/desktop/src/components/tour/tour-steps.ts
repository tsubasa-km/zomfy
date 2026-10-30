import { t } from '@/i18n/i18n'
// The guided tour's stops, in order. Each points at a part of the real window by a selector; a stop
// whose part is not on screen shows its card in the middle instead, or is passed over when optional.

export interface TourStep {
  chapter: string
  title: string
  body: string
  /** The first visible element it matches is lit; none puts the card in the middle. */
  target?: string
  /** Passed over when its target is not on screen (a hidden nav row, a fold no chat has yet). */
  optional?: boolean
}

const IS_MAC = navigator.userAgent.includes('Mac')
const MOD = IS_MAC ? '⌘' : 'Ctrl'

export const TOUR_STEPS: TourStep[] = [
  {
    chapter: t('Welcome'),
    title: t('A quick look around'),
    body: t('This tour shows the main parts of Zomfy: chats, the layout, workflows, and the pages that keep track of your agents. Use ← → or the buttons below; Esc ends it.')
  },
  {
    chapter: t('Chats'),
    title: t('Projects and their chats'),
    body: t('Each project lists its chats. Chats that need you come first, then working ones. The tag at the end of a row is the worktree the chat works in.'),
    target: '[data-project-list]'
  },
  {
    chapter: t('Chats'),
    title: t('Start a chat'),
    body: t('New chat starts one anywhere. The + beside a project (shown on hover) starts one there, in its own worktree, so agents working on different things never touch each other’s files.'),
    target: '[data-sidebar-nav="new-chat"]',
    optional: true
  },
  {
    chapter: t('Chats'),
    title: t('Chats under a chat'),
    body: t('A workflow’s step chats and a side chat fold under the chat they work for. The number says how many there are; a dot beside it means one of them is working or needs you.'),
    target: '[data-chat-fold]',
    optional: true
  },
  {
    chapter: t('Chats'),
    title: t('The composer'),
    body: t('Write to the agent here. Type / for commands and @ to mention a file. Below the box: attachments, permission mode, model, and how full the context is.'),
    target: '[data-native-chat-composer]'
  },
  {
    chapter: t('Chats'),
    title: t('Side chat'),
    body: t('Ask a quick question about the workspace without adding to the main chat. It sees the main chat’s last few messages and leaves that conversation untouched.'),
    // The labels these two stops find are shown in the window's language.
    target: `[data-right-sidebar] [aria-label^="${t('Side chat')}"]`,
    optional: true
  },
  {
    chapter: t('Layout'),
    title: t('Side by side'),
    body: t('Drag a chat from the sidebar onto the left or right edge of this area to open its workspace beside the one shown. Three or more fill two rows; drag the dividers to resize them.'),
    target: '[data-workspace-main]'
  },
  {
    chapter: t('Layout'),
    title: t('The pull-down drawer'),
    body: t('Hover the small bar under a tab strip to pull down the workspace’s terminals, browsers and panels. Pin it to keep it open.'),
    target: '[data-drawer-handle]',
    optional: true
  },
  {
    chapter: t('Layout'),
    title: t('Right sidebar'),
    body: t('Files, search, source control, checks, ports, the side chat and the agent’s details, for the workspace in focus.'),
    target: '[data-right-sidebar]',
    optional: true
  },
  {
    chapter: t('Layout'),
    title: t('Commands and shortcuts'),
    body: t('{mod}+Shift+P opens the command palette: every action, with its shortcut. {mod}+P finds a file, and {switch} switches workspace.', {
      mod: MOD,
      switch: IS_MAC ? '⌘+J' : 'Ctrl+Shift+J'
    })
  },
  {
    chapter: t('Workflows'),
    title: t('Workflows'),
    body: t('Draw a flow of steps. Each step is an agent chat, and how it ends picks the next step, so reviews, retries and questions for you are part of the flow.'),
    target: '[data-sidebar-nav="workflows"]',
    optional: true
  },
  {
    chapter: t('Workflows'),
    title: t('Run one from a chat'),
    body: t('Pick a workflow here and send: your message becomes the run’s task. The chat shows the run as a live card, answers its steps’ questions, and their chats fold under it.'),
    target: `[aria-label="${t('Run a workflow')}"]`,
    optional: true
  },
  {
    chapter: t('Keeping track'),
    title: t('Tasks'),
    body: t('Issues and pull requests from GitHub or GitLab, ready to hand to an agent.'),
    target: '[data-sidebar-nav="tasks"]',
    optional: true
  },
  {
    chapter: t('Keeping track'),
    title: t('Automations'),
    body: t('Prompts that run on a schedule, each in a chat of its own.'),
    target: '[data-sidebar-nav="automations"]',
    optional: true
  },
  {
    chapter: t('Keeping track'),
    title: t('Agent Dashboard'),
    body: t('Every chat on every host, grouped by whether it needs you, is working, or is done.'),
    target: '[data-sidebar-nav="dashboard"]',
    optional: true
  },
  {
    chapter: t('Keeping track'),
    title: t('Status bar'),
    body: t('Your hosts and their connection, the branch, the inbox of agent messages, and how many agents are working right now.'),
    target: '[data-status-bar]'
  },
  {
    chapter: t('Done'),
    title: t('That’s the tour'),
    body: t('Take it again any time: “Take the Tour” in the command palette, or Settings › General.')
  }
]
