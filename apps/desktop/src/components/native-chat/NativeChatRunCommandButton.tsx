import { createContext, useContext, useMemo } from 'react'
import { Play } from 'lucide-react'
import type { ShellOption } from '@acp-harness/protocol'
import {
  commandShellFamily,
  commandTerminalInput,
  commandTerminalTitle,
  missingShellReason,
  pickCommandShell,
  runnableCommandLines
} from './native-chat-command-run'
import { t } from '@/i18n/i18n'

export type CommandRunRequest = { shellId: string; input: string; title: string }

/** Provided by the chat transcript only, so code blocks elsewhere (skills, previews) never run. */
export const NativeChatCommandRunContext = createContext<{
  shells: readonly ShellOption[]
  sessionId: string
  run: (request: CommandRunRequest, blockKey: string) => void
} | null>(null)

/** Runs a shell fence in a terminal under the block, in the chat's workspace on the chat's host. */
export function NativeChatRunCommandButton({
  code,
  language,
  blockKey
}: {
  code: string
  language?: string
  blockKey: string
}) {
  const runner = useContext(NativeChatCommandRunContext)
  const family = commandShellFamily(language)
  const lines = useMemo(() => (family ? runnableCommandLines(code, language) : []), [code, language, family])
  if (!runner || !family || lines.length === 0) return null
  const shell = pickCommandShell(family, runner.shells)
  const label = shell ? t('Run in terminal ({shell})', { shell: shell.label }) : missingShellReason(family)
  return (
    <button
      type="button"
      data-native-chat-run-command
      onClick={() => {
        if (shell) {
          runner.run({ shellId: shell.id, input: commandTerminalInput(lines, family), title: commandTerminalTitle(lines) }, blockKey)
        }
      }}
      aria-label={label}
      aria-disabled={shell ? undefined : true}
      title={label}
      className="flex size-6 shrink-0 items-center justify-center rounded-md text-chat-foreground-faint transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-disabled:cursor-not-allowed aria-disabled:opacity-50 aria-disabled:hover:bg-transparent aria-disabled:hover:text-chat-foreground-faint"
    >
      <Play className="size-3.5" />
    </button>
  )
}
