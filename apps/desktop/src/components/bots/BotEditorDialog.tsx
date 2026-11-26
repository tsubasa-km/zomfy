import { useState } from 'react'
import { isTauri } from '@tauri-apps/api/core'
import { open as pickDirectory } from '@tauri-apps/plugin-dialog'
import { isChatAgentId, isGuardedChatAgent, type Bot, type ChatAgentId, type ChatPermissionMode } from '@zomfy/protocol'
import { LOCAL_HOST } from '@/session-store'
import { useChatAgents } from '@/lib/chat-agents'
import { createBot, updateBot } from '@/stores/bots-store'
import { MODES as PERMISSION_MODES, permissionModeLabel } from '@/components/native-chat/NativeChatPermissionModePicker'
import { TuiAgentIcon } from '@/components/terminal/TuiAgentIcon'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { BotAvatar } from './BotAvatar'
import { t } from '@/i18n/i18n'

// Create bot and Edit bot (docs/specs/bots/desktop.md#settings--bots): name, handle, avatar,
// purpose, agent, model, permission mode, and for a new bot its home: a new folder
// `~/zomfy/bots/<handle>` by default, or an existing folder or repository.

interface Draft {
  name: string
  handle: string
  avatar: string
  purpose: string
  agent: ChatAgentId
  model: string
  permissionMode: ChatPermissionMode
  home: 'new' | 'existing'
  homePath: string
  isDefault: boolean
  manager: boolean
}

/** A handle from a name: lower-case letters, digits, - and _. */
export function handleFromName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^[-_]+|-+$/g, '')
    .slice(0, 64)
}

function draftOf(bot: Bot | null): Draft {
  return {
    name: bot?.name ?? '',
    handle: bot?.handle ?? '',
    avatar: bot?.avatar ?? '',
    purpose: bot?.purpose ?? '',
    agent: bot?.agent ?? 'claude',
    model: bot?.model ?? '',
    permissionMode: bot?.permissionMode ?? 'default',
    home: 'new',
    homePath: '',
    isDefault: bot?.isDefault === true,
    manager: bot?.manager === true
  }
}

export function BotEditorDialog({
  open,
  existing,
  onOpenChange,
  onSaved
}: {
  open: boolean
  existing: Bot | null
  onOpenChange: (open: boolean) => void
  onSaved?: (bot: Bot) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg" data-bot-editor>
        {open ? (
          <BotEditorForm
            key={existing?.id ?? 'new'}
            existing={existing}
            onDone={(bot) => {
              onOpenChange(false)
              if (bot) onSaved?.(bot)
            }}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

function BotEditorForm({ existing, onDone }: { existing: Bot | null; onDone: (bot: Bot | null) => void }) {
  const [draft, setDraft] = useState(() => draftOf(existing))
  const [handleTouched, setHandleTouched] = useState(existing !== null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { agents } = useChatAgents(LOCAL_HOST)
  // Guarded agents never run unattended (GUARDED_CHAT_AGENTS), so bots cannot use them.
  const readyAgents = agents.filter((a) => a.id !== 'claude' && a.status === 'ready' && !isGuardedChatAgent(a.id))
  const patch = (change: Partial<Draft>) => setDraft((d) => ({ ...d, ...change }))

  async function browse() {
    if (!isTauri()) return
    const picked = await pickDirectory({ directory: true, title: t('Choose the bot’s home folder') })
    if (typeof picked === 'string') patch({ homePath: picked })
  }

  async function save() {
    setSaving(true)
    setError(null)
    const fields = {
      name: draft.name.trim(),
      handle: draft.handle.trim().toLowerCase(),
      avatar: draft.avatar.trim() || null,
      purpose: draft.purpose.trim() || null,
      agent: draft.agent,
      model: draft.model.trim() || null,
      permissionMode: draft.permissionMode,
      isDefault: draft.isDefault,
      manager: draft.manager
    }
    try {
      const bot = existing
        ? await updateBot(existing.id, fields)
        : await createBot({ ...fields, ...(draft.home === 'existing' ? { homePath: draft.homePath.trim() } : {}) })
      onDone(bot)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  const canSave = draft.name.trim() !== '' && draft.handle.trim() !== '' && (existing || draft.home === 'new' || draft.homePath.trim() !== '')

  return (
    <>
      <DialogHeader>
        <DialogTitle>{existing ? t('Edit bot') : t('Create bot')}</DialogTitle>
        <DialogDescription>
          {t('A bot is a named agent with a home folder on this computer. It remembers in MEMORY.md and is who SOUL.md says.')}
        </DialogDescription>
      </DialogHeader>
      <form
        className="grid gap-3"
        onSubmit={(e) => {
          e.preventDefault()
          if (canSave && !saving) void save()
        }}
      >
        <div className="flex items-end gap-3">
          <BotAvatar bot={{ name: draft.name || '?', handle: draft.handle || 'x', avatar: draft.avatar || null }} size={36} />
          <Field label={t('Name')} className="flex-1">
            <Input
              autoFocus
              value={draft.name}
              data-bot-field="name"
              placeholder={t('Reviewer')}
              onChange={(e) => {
                const name = e.target.value
                patch({ name, ...(handleTouched ? {} : { handle: handleFromName(name) }) })
              }}
            />
          </Field>
          <Field label={t('Avatar')} className="w-24">
            <Input value={draft.avatar} data-bot-field="avatar" placeholder="🤖" onChange={(e) => patch({ avatar: e.target.value })} />
          </Field>
        </div>
        <Field label={t('Handle')} hint={t('Ask it with @{handle} in a chat, or after the bot’s mention in Discord.', { handle: draft.handle || 'handle' })}>
          <Input
            value={draft.handle}
            data-bot-field="handle"
            placeholder="reviewer"
            onChange={(e) => {
              setHandleTouched(true)
              patch({ handle: e.target.value.toLowerCase() })
            }}
          />
        </Field>
        <Field label={t('Purpose')} hint={t('Optional. One line on what it is for; SOUL.md says the rest.')}>
          <Textarea rows={2} value={draft.purpose} data-bot-field="purpose" onChange={(e) => patch({ purpose: e.target.value })} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('Agent')}>
            <Select value={draft.agent} onValueChange={(value) => isChatAgentId(value) && patch({ agent: value })}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper">
                <SelectItem value="claude">
                  <TuiAgentIcon agent="claude" size={14} />
                  Claude
                </SelectItem>
                {readyAgents.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    <TuiAgentIcon agent={a.id} size={14} />
                    {a.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label={t('Model')} hint={t('Empty: the agent’s default.')}>
            <Input value={draft.model} data-bot-field="model" placeholder={t('Default')} onChange={(e) => patch({ model: e.target.value })} />
          </Field>
        </div>
        <Field label={t('Permission mode')} hint={t('Others can ask a bot, so a new one asks for approval before each tool use.')}>
          <Select value={draft.permissionMode} onValueChange={(value) => patch({ permissionMode: value as ChatPermissionMode })}>
            <SelectTrigger className="w-full" data-bot-field="permission-mode">
              <SelectValue />
            </SelectTrigger>
            <SelectContent position="popper">
              {PERMISSION_MODES.map((mode) => (
                <SelectItem key={mode} value={mode}>
                  {permissionModeLabel(mode)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        {existing ? null : (
          <Field label={t('Home')}>
            <Select value={draft.home} onValueChange={(value) => patch({ home: value === 'existing' ? 'existing' : 'new' })}>
              <SelectTrigger className="w-full" data-bot-field="home">
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper">
                <SelectItem value="new">{t('A new folder, ~/zomfy/bots/{handle}', { handle: draft.handle || 'handle' })}</SelectItem>
                <SelectItem value="existing">{t('An existing folder or repository')}</SelectItem>
              </SelectContent>
            </Select>
            {draft.home === 'existing' ? (
              <div className="flex gap-2">
                <Input
                  value={draft.homePath}
                  data-bot-field="home-path"
                  placeholder={t('Folder path')}
                  onChange={(e) => patch({ homePath: e.target.value })}
                />
                {isTauri() ? (
                  <Button type="button" variant="outline" onClick={() => void browse()}>
                    {t('Browse…')}
                  </Button>
                ) : null}
              </div>
            ) : null}
          </Field>
        )}
        <label className="flex items-center justify-between gap-3 text-sm">
          <span className="grid gap-0.5">
            {t('Default bot')}
            <span className="text-[11px] text-muted-foreground">{t('Takes messages in Discord and other sources that name no bot.')}</span>
          </span>
          <Switch checked={draft.isDefault} data-bot-field="default" onCheckedChange={(isDefault) => patch({ isDefault })} />
        </label>
        <label className="flex items-center justify-between gap-3 text-sm">
          <span className="grid gap-0.5">
            {t('Manager across projects')}
            <span className="text-[11px] text-muted-foreground">
              {t('Sees and drives the chats, workspaces and worktrees of every project, as the Manager chat does.')}
            </span>
          </span>
          <Switch checked={draft.manager} data-bot-field="manager" onCheckedChange={(manager) => patch({ manager })} />
        </label>
        {error ? (
          <p className="text-xs text-destructive" data-bot-error>
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onDone(null)}>
            {t('Cancel')}
          </Button>
          <Button type="submit" disabled={!canSave || saving} data-bot-save>
            {existing ? t('Save') : t('Create bot')}
          </Button>
        </DialogFooter>
      </form>
    </>
  )
}

function Field({ label, hint, className, children }: { label: string; hint?: string; className?: string; children: React.ReactNode }) {
  return (
    <div className={`grid min-w-0 gap-1.5 ${className ?? ''}`}>
      <Label className="text-xs">{label}</Label>
      {children}
      {hint ? <p className="text-[11px] text-muted-foreground">{hint}</p> : null}
    </div>
  )
}
