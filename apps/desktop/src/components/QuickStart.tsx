import { useState } from 'react'
import { ArrowUp, FolderPlus, GitBranch } from 'lucide-react'
import { toast } from 'sonner'
import { HARNESS_METHODS, isChatAgentId } from '@acp-harness/protocol'
import { createSession, harnessRequest } from '@/daemon-connection'
import { LOCAL_HOST, selectWorkspace, useStore, type HostId } from '@/session-store'
import { submitPrompt } from '@/chat-actions'
import { useSetting } from '@/stores/settings-store'
import { isSubmitShortcut, SUBMIT_SHORTCUT_LABEL } from '@/lib/terminal-shortcuts'
import { openAddProjectDialog } from '@/lib/project-dialogs'
import { sortedHosts } from '@/components/settings/HostsPane'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

// The empty main view, as in the Claude apps: type and go. The chat starts in its own scratch
// folder and its agent moves it into a project when the work needs one (move_chat).

export function QuickStart() {
  const hosts = useStore((s) => s.hosts)
  const connected = sortedHosts(hosts).filter((h) => h.connection.kind === 'connected')
  const [hostId, setHostId] = useState<HostId>(LOCAL_HOST)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const sendKey = useSetting('chatSendKey')
  const defaultAgent = useSetting('defaultChatAgent')
  const target = connected.some((h) => h.id === hostId) ? hostId : (connected[0]?.id ?? LOCAL_HOST)

  async function start() {
    const text = draft.trim()
    if (!text || busy) return
    setBusy(true)
    try {
      const workspace = await harnessRequest(HARNESS_METHODS.workspaceCreateScratch, {}, target)
      const sessionId = await createSession(workspace.id, isChatAgentId(defaultAgent) ? defaultAgent : undefined, {
        hostId: target
      })
      selectWorkspace(workspace.id)
      submitPrompt(sessionId, text, [])
      setDraft('')
    } catch (error) {
      toast.error('Could not start the chat', { description: error instanceof Error ? error.message : String(error) })
    } finally {
      setBusy(false)
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key !== 'Enter' || e.shiftKey || e.altKey || e.nativeEvent.isComposing) return
    if (isSubmitShortcut(e) || (sendKey === 'enter' && !e.ctrlKey && !e.metaKey)) {
      e.preventDefault()
      void start()
    }
  }

  return (
    <div className="m-auto flex w-full max-w-xl flex-col gap-4 px-6" data-quick-start>
      <div className="space-y-1 text-center">
        <h1 className="text-lg font-medium text-foreground">What should we work on?</h1>
        <p className="text-xs text-muted-foreground">
          Starts right away in a fresh folder. The agent moves the chat into a project when the work needs one.
        </p>
      </div>
      <div className="rounded-xl border border-input bg-card p-1.5 shadow-xs focus-within:border-ring">
        <Textarea
          autoFocus
          value={draft}
          disabled={busy}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Ask anything, or describe a task"
          aria-label="Start a chat"
          className="max-h-60 min-h-20 resize-none border-0 bg-transparent shadow-none focus-visible:ring-0 dark:bg-transparent"
        />
        <div className="flex items-center justify-between gap-2 px-1 pt-1">
          {connected.length > 1 ? (
            <Select value={target} onValueChange={setHostId}>
              <SelectTrigger size="sm" className="h-7 w-auto border-0 text-xs shadow-none" aria-label="Host">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {connected.map((h) => (
                  <SelectItem key={h.id} value={h.id}>
                    {h.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <span />
          )}
          <Button
            size="icon"
            className="size-7 rounded-full"
            disabled={!draft.trim() || busy}
            aria-label={`Start chat (${sendKey === 'enter' ? '↵' : SUBMIT_SHORTCUT_LABEL})`}
            onClick={() => void start()}
          >
            <ArrowUp className="size-4" />
          </Button>
        </div>
      </div>
      <div className="flex justify-center gap-2">
        <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => openAddProjectDialog({ hostId: target })}>
          <FolderPlus className="size-4" />
          Add a project
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground"
          onClick={() => openAddProjectDialog({ hostId: target, step: 'clone' })}
        >
          <GitBranch className="size-4" />
          Clone a repository
        </Button>
      </div>
    </div>
  )
}
