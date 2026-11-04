import { t } from '@/i18n/i18n'
import { getAppOverlays } from '@/stores/app-overlay-store'
import { getWorkflowsPage } from '@/stores/workflows-store'

// The guided tour's stops, in order. Each points at a part of the real window by a selector; a stop
// whose part is not on screen shows its card in the middle instead, or is passed over when optional.
// A try-it stop lets the lit part be used, and goes on once the person has done what it asks.

export interface TourAction {
  /** What the person is asked to do, shown on the card. */
  prompt: string
  /** Done when the lit part is clicked, or the pointer comes onto it. */
  on?: 'click' | 'hover'
  /** Only a click inside this, within the lit part, counts. */
  within?: string
  /** The tour steps aside while this holds (a palette or page the person opened), and goes on once it ends. */
  aside?: () => boolean
}

export interface TourStep {
  chapter: string
  title: string
  body: string
  /** The first visible element the first matching selector finds is lit; none puts the card in the middle. */
  target?: string | string[]
  /** Passed over when its target is not on screen (a hidden nav row, a fold no chat has yet). */
  optional?: boolean
  action?: TourAction
}

const IS_MAC = navigator.userAgent.includes('Mac')
const MOD = IS_MAC ? '⌘' : 'Ctrl'
// The open drawer is lit whole, so the pointer can stay on it; when it has closed, the bar that opens it is.
const DRAWER = ['[data-drawer="open"]', '[data-drawer-handle]']

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
    title: t('Chats under a chat'),
    body: t('A workflow’s step chats and a side chat fold under the chat they work for. The number says how many there are; a dot beside it means one of them is working or needs you.'),
    target: '[data-chat-fold]',
    optional: true,
    action: { prompt: t('Click the arrow to fold or unfold the chats under it.'), on: 'click' }
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
    title: t('The composer'),
    body: t('Write to the agent here. Type / for commands and @ to mention a file. Below the box: attachments, permission mode, model, and how full the context is.'),
    target: '[data-native-chat-composer]'
  },
  {
    chapter: t('Chats'),
    title: t('Side chat'),
    body: t('Ask a quick question about the workspace without adding to the main chat. It sees the main chat’s last few messages and leaves that conversation untouched.'),
    // The label this stop finds is shown in the window's language.
    target: `[data-right-sidebar] [aria-label^="${t('Side chat')}"]`,
    optional: true,
    action: { prompt: t('Click it to open the side chat panel.'), on: 'click' }
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
    body: t('The open tab has a small tab under the tab strip. It pulls down the workspace’s terminals, browsers and panels.'),
    target: '[data-drawer-handle]',
    optional: true,
    action: { prompt: t('Point at the tab and wait a moment.'), on: 'hover' }
  },
  {
    chapter: t('Layout'),
    title: t('Keep it open'),
    body: t('The drawer closes when the pointer leaves it. The same tab, now under the drawer, pins it open.'),
    target: DRAWER,
    optional: true,
    action: { prompt: t('Click the tab under the drawer. (If the drawer closed, point at the tab again.)'), on: 'click', within: '[data-drawer-pin]' }
  },
  {
    chapter: t('Layout'),
    title: t('Let it close'),
    body: t('Unpinned, it slides away as soon as the pointer moves off it.'),
    target: DRAWER,
    optional: true,
    action: { prompt: t('Click the tab again, then move away.'), on: 'click', within: '[data-drawer-pin]' }
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
    body: t('The command palette lists every action with its shortcut. {mod}+P finds a file, and {switch} switches workspace.', {
      mod: MOD,
      switch: IS_MAC ? '⌘+J' : 'Ctrl+Shift+J'
    }),
    action: {
      prompt: t('Press {mod}+Shift+P to open it, look around, then press Esc.', { mod: MOD }),
      aside: () => getAppOverlays().commandPalette
    }
  },
  {
    chapter: t('Workflows'),
    title: t('Workflows'),
    body: t('Draw a flow of steps. Each step is an agent chat, and how it ends picks the next step, so reviews, retries and questions for you are part of the flow.'),
    target: '[data-sidebar-nav="workflows"]',
    optional: true,
    action: {
      prompt: t('Click it to open the Workflows page. Click it again to come back to the tour.'),
      aside: () => getWorkflowsPage() !== null
    }
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
