import { ArrowRight, BookOpen } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { setSkillsPageOpen } from '@/stores/app-overlay-store'
import { setSetting, useSetting } from '@/stores/settings-store'
import { SettingsSwitchRow } from './settings-form-controls'
import { SearchableSetting } from './SettingsSection'

// Orca's Skills settings pane links to the Skills page; sharing through Orca's cloud is not ported.

export function SkillsPane() {
  const showButton = useSetting('showSkillsButton')
  return (
    <div className="space-y-4">
      <SearchableSetting entry={{ title: 'Open Skills', keywords: ['skills', 'SKILL.md', 'browse'] }}>
        <Button
          type="button"
          variant="ghost"
          className="h-auto w-full justify-start rounded-md border border-border/60 bg-muted/20 px-4 py-3 text-left whitespace-normal hover:bg-muted/35 hover:text-foreground"
          onClick={() => setSkillsPageOpen(true)}
          data-open-skills
        >
          <span className="flex size-8 shrink-0 items-center justify-center rounded-md border border-border bg-background text-muted-foreground">
            <BookOpen className="size-4" />
          </span>
          <span className="min-w-0 flex-1 space-y-0.5">
            <span className="block text-sm font-medium text-foreground">Open Skills</span>
            <span className="block text-xs font-normal text-muted-foreground">
              Browse the skills each host&apos;s agents can load, read their SKILL.md, or remove ones you no longer want.
            </span>
          </span>
          <ArrowRight className="ml-auto size-4 shrink-0 text-muted-foreground" />
        </Button>
      </SearchableSetting>
      <SettingsSwitchRow
        label="Show Skills in sidebar"
        description="Adds a Skills row to the sidebar navigation."
        keywords={['skills', 'sidebar', 'button']}
        checked={showButton}
        onChange={(checked) => setSetting('showSkillsButton', checked)}
      />
    </div>
  )
}
