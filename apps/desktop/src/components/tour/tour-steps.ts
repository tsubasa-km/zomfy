import { t } from '@/i18n/i18n'
import { getAppOverlays } from '@/stores/app-overlay-store'
import { getSetting } from '@/stores/settings-store'
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
    body: t('This tour shows the main parts of Zomfy: threads, the layout, workflows, and the pages that keep track of your agents. Use ← → or the buttons below; Esc ends it.')
  },
  {
    chapter: t('Threads'),
    title: t('Projects and their threads'),
    body: t('Each project lists its threads. Threads that need you come first, then working ones. The tag at the end of a row is the worktree the thread works in.'),
    target: '[data-project-list]'
  },
  {
    chapter: t('Threads'),
    title: t('Threads under a thread'),
    body: t('A workflow’s step threads and a side chat fold under the thread they work for. The number says how many there are; a dot beside it means one of them is working or needs you.'),
    target: '[data-chat-fold]',
    optional: true,
    action: { prompt: t('Click the arrow to fold or unfold the threads under it.'), on: 'click' }
  },
  {
    chapter: t('Threads'),
    title: t('Start a thread'),
    body: t('New thread starts one anywhere. The + beside a project (shown on hover) starts one there, in its own worktree, so agents working on different things never touch each other’s files.'),
    target: '[data-sidebar-nav="new-chat"]',
    optional: true
  },
  {
    chapter: t('Threads'),
    title: t('The composer'),
    body: t('Write to the agent here. Type / for commands and @ to mention a file. Below the box: attachments, permission mode, model, and how full the context is.'),
    target: '[data-native-chat-composer]'
  },
  {
    chapter: t('Layout'),
    title: t('Side by side'),
    body: t('Drag a thread or a project from the sidebar onto any edge of a pane to open its workspace beside it, or onto its middle to take its place. Drag a pane by its name bar to move it, or out of the window to give it a window of its own; drag the dividers to resize.'),
    target: '[data-workspace-main]'
  },
  {
    chapter: t('Layout'),
    title: t('The tool drawer'),
    body: t('The drawer holds the workspace’s tools. Drag its handle along the edge or pull it toward another edge to move it.'),
    target: '[data-drawer-handle]',
    optional: true,
    action: {
      get prompt() {
        return getSetting('drawerOpenAction') === 'click' ? t('Click the drawer handle.') : t('Point at the tab and wait a moment.')
      },
      get on() {
        return getSetting('drawerOpenAction')
      }
    }
  },
  {
    chapter: t('Layout'),
    title: t('Keep it open'),
    body: t('The drawer closes when the pointer leaves it. Click the pin tab on its inner edge to keep it open.'),
    target: DRAWER,
    optional: true,
    action: { prompt: t('Click the pin tab. If the drawer closed, reopen it with its handle.'), on: 'click', within: '[data-drawer-pin]' }
  },
  {
    chapter: t('Layout'),
    title: t('Side chat'),
    body: t('Ask a quick question about the workspace without adding to the main thread. It sees the main thread’s last few messages and leaves that conversation untouched.'),
    target: '[data-drawer="open"] [data-drawer-panel="panel:side-chat"]',
    optional: true,
    action: { prompt: t('Click it to open the side chat panel.'), on: 'click' }
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
    body: t('Draw a flow of steps. Each step is an agent thread, and how it ends picks the next step, so reviews, retries and questions for you are part of the flow.'),
    target: '[data-sidebar-nav="workflows"]',
    optional: true,
    action: {
      prompt: t('Click it to open the Workflows page. Click it again to come back to the tour.'),
      aside: () => getWorkflowsPage() !== null
    }
  },
  {
    chapter: t('Workflows'),
    title: t('Run one from a thread'),
    body: t('Pick a workflow here and send: your message becomes the run’s task. The thread shows the run as a live card, answers its steps’ questions, and their threads fold under it.'),
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
    body: t('Prompts that run on a schedule, each in a thread of its own.'),
    target: '[data-sidebar-nav="automations"]',
    optional: true
  },
  {
    chapter: t('Keeping track'),
    title: t('Agent Dashboard'),
    body: t('Every thread on every host, grouped by whether it needs you, is working, or is done.'),
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
