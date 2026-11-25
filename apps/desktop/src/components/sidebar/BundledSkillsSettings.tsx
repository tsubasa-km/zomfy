import { useEffect, useState } from 'react'
import { HARNESS_METHODS, type BundledSkill } from '@zomfy/protocol'
import { harnessRequest } from '@/daemon-connection'
import type { HostedProject } from '@/session-store'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { t } from '@/i18n/i18n'

// Zomfy's bundled skills in Project Settings (spec worktree-skills-and-storage A, decided per project
// and per agent). A switch applies at once: the daemon links the skill into, or out of, every
// workspace of the project.

export function BundledSkillsSettings({ project }: { project: HostedProject }) {
  const [skills, setSkills] = useState<BundledSkill[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setSkills(null)
    setError(null)
    // An older daemon has no bundled skills: the section stays hidden.
    void harnessRequest(HARNESS_METHODS.bundledList, { projectId: project.id }, project.hostId).then(setSkills, () => setSkills([]))
  }, [project])

  async function run(request: () => Promise<BundledSkill[]>) {
    setBusy(true)
    setError(null)
    try {
      setSkills(await request())
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  if (!skills || skills.length === 0) return null
  return (
    <div className="space-y-2" data-bundled-skills>
      <p className="text-xs font-medium text-muted-foreground">{t("Zomfy's skills")}</p>
      {skills.map((skill) => (
        <div key={skill.name} className="space-y-1.5 rounded-md border border-border/60 px-2.5 py-2" data-bundled-skill={skill.name}>
          <div className="space-y-0.5">
            <p className="font-mono text-xs">{skill.name}</p>
            <p className="text-[11px] text-muted-foreground">{t(skill.description)}</p>
          </div>
          {skill.agents.map((agent) => {
            const id = `bundled-${skill.name}-${agent.agent}`
            return (
              <div key={agent.agent} className="flex items-start justify-between gap-3">
                <div className="min-w-0 space-y-0.5">
                  <Label htmlFor={id} className="text-sm font-normal">
                    {agent.label}
                  </Label>
                  {agent.blocked > 0 && (
                    <p className="text-[11px] text-muted-foreground">
                      {t('{n} workspaces already have a folder of their own by this name; it is left alone.', { n: agent.blocked })}
                    </p>
                  )}
                </div>
                <Switch
                  id={id}
                  checked={agent.enabled}
                  disabled={busy}
                  data-bundled-skill-agent={agent.agent}
                  onCheckedChange={(enabled) =>
                    void run(() =>
                      harnessRequest(HARNESS_METHODS.bundledSet, { projectId: project.id, name: skill.name, agent: agent.agent, enabled }, project.hostId)
                    )
                  }
                />
              </div>
            )
          })}
          {skill.copyState === 'edited' && (
            <div className="flex items-center justify-between gap-3">
              <p className="text-[11px] text-muted-foreground">{t('Edited by hand, so updates leave it alone.')}</p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => void run(() => harnessRequest(HARNESS_METHODS.bundledReplace, { projectId: project.id, name: skill.name }, project.hostId))}
              >
                {t("Replace with Zomfy's version")}
              </Button>
            </div>
          )}
          <p className="text-[11px] text-muted-foreground">{t('Applies right away to every workspace of the project, new ones included.')}</p>
        </div>
      ))}
      {error && <p className="text-xs break-words text-destructive">{error}</p>}
    </div>
  )
}
