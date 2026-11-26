import { CHAT } from './chat'
import { DEVICES } from './devices'
import { BOTS } from './bots'
import { COMMON } from './common'
import { PAGES } from './pages'
import { RESOLVED } from './resolved'
import { SHELL } from './shell'
import { RELAY } from './relay'

// One table per area of the app, so each can be filled in on its own.
export const JA: Record<string, string> = { ...COMMON, ...SHELL, ...CHAT, ...PAGES, ...RESOLVED, ...DEVICES, ...BOTS, ...RELAY }
