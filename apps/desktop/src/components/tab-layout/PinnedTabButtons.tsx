import { PinOff } from 'lucide-react'
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from '@/components/ui/context-menu'
import { cn } from '@/lib/utils'
import { parsePin } from '@/lib/new-tab-pins'
import { focusGroup } from './tab-group-commands'
import {
  unpinNewTabItem,
  useBrowserItems,
  useChatItems,
  useCommandItems,
  useNewTabPins,
  usePanelItems,
  useSshItems,
  useTerminalItems,
  useTuiAgentItems,
  useWorkflowItems,
  type NewTabItem
} from './new-tab-items'
import { t } from '@/i18n/i18n'

// The "+" menu's pinned items as buttons beside it, in pin order (docs/specs/new-tab-menu-and-pins.md).
// Each button calls only its own kind's hook; a pin whose item this workspace lacks shows nothing.

type Props = { workspaceId: string; groupId: string; pin: string }

function PinnedButton({ workspaceId, groupId, pin, item }: Props & { item: NewTabItem | undefined }) {
  if (!item || item.disabled) return null
  return (
    <ContextMenu modal={false}>
      <ContextMenuTrigger asChild>
        <button
          type="button"
          aria-label={item.label}
          title={item.label}
          data-pinned-tab={pin}
          className={cn(
            'my-auto ml-1 flex h-7 shrink-0 items-center gap-1 rounded-md text-muted-foreground hover:bg-accent/50 hover:text-foreground focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none [&_svg]:size-3.5',
            item.short ? 'max-w-[140px] px-1.5' : 'w-7 justify-center'
          )}
          onClick={() => {
            focusGroup(workspaceId, groupId)
            item.run()
          }}
        >
          <span className="flex shrink-0 items-center">{item.icon}</span>
          {item.short ? <span className="min-w-0 truncate text-[12px] font-medium">{item.short}</span> : null}
        </button>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem data-unpin-tab={pin} onSelect={() => unpinNewTabItem(pin)}>
          <PinOff className="size-4" />
          {t('Unpin')}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}

const find = (items: NewTabItem[], pin: string) => items.find((i) => i.pin === pin)

function TerminalPin(p: Props) {
  return <PinnedButton {...p} item={find(useTerminalItems(p.workspaceId), p.pin)} />
}
function BrowserPin(p: Props) {
  return <PinnedButton {...p} item={find(useBrowserItems(p.workspaceId), p.pin)} />
}
function ChatPin(p: Props) {
  return <PinnedButton {...p} item={find(useChatItems(p.workspaceId), p.pin)} />
}
function AgentPin(p: Props) {
  return <PinnedButton {...p} item={find(useTuiAgentItems(p.workspaceId).items, p.pin)} />
}
function CommandPin(p: Props) {
  return <PinnedButton {...p} item={find(useCommandItems(p.workspaceId), p.pin)} />
}
function WorkflowPin(p: Props) {
  return <PinnedButton {...p} item={find(useWorkflowItems(p.workspaceId), p.pin)} />
}
function SshPin(p: Props) {
  return <PinnedButton {...p} item={find(useSshItems(p.workspaceId), p.pin)} />
}
function PanelPin(p: Props) {
  return <PinnedButton {...p} item={find(usePanelItems(p.workspaceId), p.pin)} />
}

const BY_KIND = {
  terminal: TerminalPin,
  browser: BrowserPin,
  chat: ChatPin,
  agent: AgentPin,
  command: CommandPin,
  workflow: WorkflowPin,
  ssh: SshPin,
  panel: PanelPin
} as const

export function PinnedTabButtons({ workspaceId, groupId }: { workspaceId: string; groupId: string }) {
  const pins = useNewTabPins()
  return (
    <>
      {pins.map((pin) => {
        const Button = BY_KIND[parsePin(pin).kind]
        return <Button key={pin} workspaceId={workspaceId} groupId={groupId} pin={pin} />
      })}
    </>
  )
}
