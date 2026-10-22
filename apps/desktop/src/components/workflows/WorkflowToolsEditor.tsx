import { useEffect, useState } from 'react'
import { Plus, X } from 'lucide-react'
import { HARNESS_METHODS, type DiscoveredSkill, type WorkflowMcpServer, type WorkflowToolPolicy } from '@acp-harness/protocol'
import { harnessRequest } from '@/daemon-connection'
import type { HostId } from '@/session-store'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'

// What a step's sessions may use. The engine hands this to each session it starts for the step,
// so it holds whatever the prompt says: a reviewer without Edit cannot edit.

const PLAYWRIGHT: WorkflowMcpServer = { name: 'playwright', preset: 'playwright' }

function ToggleRow({ label, hint, checked, onChange }: { label: string; hint: string; checked: boolean; onChange: (on: boolean) => void }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="space-y-0.5">
        <div className="text-xs font-medium">{label}</div>
        <p className="text-[11px] text-muted-foreground">{hint}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} aria-label={label} />
    </div>
  )
}

function list(text: string): string[] {
  return text
    .split(/[,\s]+/)
    .map((t) => t.trim())
    .filter(Boolean)
}

/** The host's skills, read once per editor. */
function useHostSkills(hostId: HostId, wanted: boolean): DiscoveredSkill[] | null {
  const [skills, setSkills] = useState<DiscoveredSkill[] | null>(null)
  useEffect(() => {
    if (!wanted || skills) return
    void harnessRequest(HARNESS_METHODS.skillsDiscover, {}, hostId).then(
      (result) => setSkills(result.skills),
      () => setSkills([])
    )
  }, [hostId, wanted, skills])
  return skills
}

export function WorkflowToolsEditor({
  hostId,
  tools,
  onChange
}: {
  hostId: HostId
  tools: WorkflowToolPolicy | undefined
  onChange: (tools: WorkflowToolPolicy) => void
}) {
  const policy = tools ?? {}
  const mcp = policy.mcp ?? []
  const set = (patch: Partial<WorkflowToolPolicy>) => onChange({ ...policy, ...patch })
  const hasBrowser = mcp.some((s) => s.preset === 'playwright')
  const custom = mcp.filter((s) => !s.preset)
  const limitSkills = policy.skills !== undefined
  const skills = useHostSkills(hostId, limitSkills)
  const setCustom = (next: WorkflowMcpServer[]) => set({ mcp: [...mcp.filter((s) => s.preset), ...next] })

  return (
    <div className="space-y-3 rounded-md border border-border p-3" data-workflow-tools>
      <Label className="text-xs">Tools</Label>
      <ToggleRow
        label="Browser (Playwright)"
        hint="Opens pages, takes screenshots and reads the DOM; its tools run without asking."
        checked={hasBrowser}
        onChange={(on) => set({ mcp: on ? [...mcp, PLAYWRIGHT] : mcp.filter((s) => s.preset !== 'playwright') })}
      />
      <ToggleRow
        label="Read only"
        hint="No Edit, Write or NotebookEdit, whatever the instructions say."
        checked={policy.readOnly === true}
        onChange={(on) => set({ readOnly: on || undefined })}
      />

      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <div className="text-xs font-medium">Other MCP servers</div>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-1.5 text-xs"
            onClick={() => setCustom([...custom, { name: `server${custom.length + 1}`, command: '', args: [] }])}
          >
            <Plus className="size-3" />
            Add
          </Button>
        </div>
        {custom.map((server, index) => (
          <div key={index} className="flex items-center gap-1.5">
            <Input
              value={server.name}
              onChange={(e) => setCustom(custom.map((s, i) => (i === index ? { ...s, name: e.target.value.replace(/\s+/g, '_') } : s)))}
              className="h-7 w-24 font-mono text-xs"
              aria-label="Server name"
            />
            <Input
              value={[server.command ?? '', ...(server.args ?? [])].join(' ').trim()}
              placeholder="npx -y some-mcp-server"
              onChange={(e) => {
                const [command = '', ...args] = e.target.value.split(' ')
                setCustom(custom.map((s, i) => (i === index ? { ...s, command, args } : s)))
              }}
              className="h-7 flex-1 font-mono text-xs"
              aria-label="Server command"
            />
            <Button
              variant="ghost"
              size="icon"
              className="size-6 shrink-0"
              aria-label="Remove server"
              onClick={() => setCustom(custom.filter((_, i) => i !== index))}
            >
              <X className="size-3.5" />
            </Button>
          </div>
        ))}
        {mcp.length > 0 && (
          <ToggleRow
            label="Only these servers"
            hint="Leave out the MCP servers from the host's Claude settings."
            checked={policy.strictMcp === true}
            onChange={(on) => set({ strictMcp: on || undefined })}
          />
        )}
      </div>

      <div className="space-y-1.5">
        <ToggleRow
          label="Limit skills"
          hint="Only the checked skills are listed and callable (their files stay readable)."
          checked={limitSkills}
          onChange={(on) => set({ skills: on ? [] : undefined })}
        />
        {limitSkills && (
          <div className="max-h-40 space-y-1 overflow-y-auto rounded border border-border p-1.5" data-workflow-skills>
            {skills === null && <p className="text-[11px] text-muted-foreground">Reading the host's skills…</p>}
            {skills?.length === 0 && <p className="text-[11px] text-muted-foreground">No skills found on this host.</p>}
            {[...new Map((skills ?? []).map((s) => [s.name, s])).values()].map((skill) => (
              <label key={skill.name} className="flex items-start gap-2 text-xs" title={skill.description ?? undefined}>
                <Checkbox
                  checked={policy.skills?.includes(skill.name) ?? false}
                  onCheckedChange={(on) =>
                    set({
                      skills: on === true ? [...(policy.skills ?? []), skill.name] : (policy.skills ?? []).filter((n) => n !== skill.name)
                    })
                  }
                  className="mt-0.5"
                />
                <span className="min-w-0 truncate">{skill.name}</span>
              </label>
            ))}
          </div>
        )}
      </div>

      <div className="space-y-1.5">
        <div className="text-xs font-medium">Allow without asking</div>
        <Input
          value={(policy.allow ?? []).join(', ')}
          placeholder="Bash(bun test:*), mcp__server"
          onChange={(e) => set({ allow: list(e.target.value) })}
          className="h-7 font-mono text-xs"
          aria-label="Allowed tools"
        />
        <div className="text-xs font-medium">Never allow</div>
        <Input
          value={(policy.deny ?? []).join(', ')}
          placeholder="WebFetch, Bash(git push:*)"
          onChange={(e) => set({ deny: list(e.target.value) })}
          className="h-7 font-mono text-xs"
          aria-label="Denied tools"
        />
      </div>
    </div>
  )
}
