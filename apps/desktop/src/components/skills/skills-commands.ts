import { registerKeybindingDefinitions } from '@/keybindings/keybinding-definitions'
import { registerCommandHandler } from '@/keybindings/keybinding-registry'
import { setSkillsPageOpen } from '@/stores/app-overlay-store'

/** "Open Skills" in the palette and shortcuts editor; the open page shadows it to close itself. */
export function installSkillsCommands(): void {
  registerKeybindingDefinitions([
    { id: 'skills.open', title: 'Open Skills', group: 'Global', keywords: ['skills', 'SKILL.md', 'agent skills'], defaultBindings: [] }
  ])
  registerCommandHandler('skills.open', () => setSkillsPageOpen(true))
}
