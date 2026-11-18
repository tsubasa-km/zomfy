import { File, Folder, FolderOpen } from 'lucide-react'
import { createExternalStore } from '@/stores/external-store'
import { fileIconName, folderIconName, type FileIconRules } from '@/lib/file-icons/icon-rules'
import { cn } from '@/lib/utils'

// File and folder icons in the manner of VS Code's Material Icon Theme: one per kind of file, and
// per well-known folder. The rules load once, on the first icon drawn; until then, and should they
// fail to, the plain outline icons stand in.

interface IconState {
  rules: FileIconRules | null
  dark: boolean
}

const store = createExternalStore<IconState>({ rules: null, dark: true })
let started = false

function start(): void {
  if (started) return
  started = true
  const root = document.documentElement
  const readTheme = (): void => store.update((state) => ({ ...state, dark: root.classList.contains('dark') }))
  readTheme()
  new MutationObserver(readTheme).observe(root, { attributes: true, attributeFilter: ['class'] })
  void import('virtual:file-icon-rules').then(
    (module) => store.update((state) => ({ ...state, rules: module.default })),
    () => undefined
  )
}

const iconUrl = (name: string): string => `${import.meta.env.BASE_URL}file-icons/${name}.svg`

function useIcon(pick: (rules: FileIconRules, light: boolean) => string): string | null {
  start()
  return store.use((state) => (state.rules ? pick(state.rules, !state.dark) : null))
}

const imageClass = 'pointer-events-none shrink-0 select-none'

/** `name` may be a path; then the folder it is in counts too. */
export function FileIcon({ name, className }: { name: string; className?: string }) {
  const icon = useIcon((rules, light) => fileIconName(rules, name, { light }))
  if (!icon) return <File className={cn('shrink-0 text-muted-foreground', className)} />
  return <img src={iconUrl(icon)} alt="" draggable={false} data-file-icon={icon} className={cn(imageClass, className)} />
}

export function FolderIcon({ name, open, root, className }: { name: string; open?: boolean; root?: boolean; className?: string }) {
  const icon = useIcon((rules, light) => folderIconName(rules, name, { light, open, root }))
  if (!icon) {
    const Outline = open ? FolderOpen : Folder
    return <Outline className={cn('shrink-0 text-muted-foreground', className)} />
  }
  return <img src={iconUrl(icon)} alt="" draggable={false} data-file-icon={icon} className={cn(imageClass, className)} />
}
