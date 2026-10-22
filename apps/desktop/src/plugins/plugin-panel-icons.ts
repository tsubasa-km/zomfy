import {
  Activity,
  BarChart3,
  Bell,
  Blocks,
  Book,
  Bot,
  Bug,
  Calendar,
  Cloud,
  Code,
  Database,
  FileText,
  Flag,
  Folder,
  Gauge,
  Globe,
  Hammer,
  Layers,
  Lightbulb,
  Package,
  Plug,
  Puzzle,
  Rocket,
  Star,
  Terminal,
  Wrench,
  Zap,
  type LucideIcon
} from 'lucide-react'

// Orca's plugin-panel-activity-items.ts: manifests pick from a curated set, since lucide's full
// `icons` map would bundle every icon.
const PLUGIN_PANEL_ICONS: Record<string, LucideIcon> = {
  activity: Activity,
  barchart3: BarChart3,
  bell: Bell,
  blocks: Blocks,
  book: Book,
  bot: Bot,
  bug: Bug,
  calendar: Calendar,
  cloud: Cloud,
  code: Code,
  database: Database,
  filetext: FileText,
  flag: Flag,
  folder: Folder,
  gauge: Gauge,
  globe: Globe,
  hammer: Hammer,
  layers: Layers,
  lightbulb: Lightbulb,
  package: Package,
  plug: Plug,
  puzzle: Puzzle,
  rocket: Rocket,
  star: Star,
  terminal: Terminal,
  wrench: Wrench,
  zap: Zap
}

/** Accepts 'file-text' and 'FileText'; unknown names fall back to Puzzle (Plug is the Ports tab here). */
export function resolvePluginPanelIcon(name: string | undefined): LucideIcon {
  if (!name) return Puzzle
  const key = name.replaceAll('-', '').toLowerCase()
  // Own keys only, so `constructor` cannot resolve to an inherited member.
  return Object.hasOwn(PLUGIN_PANEL_ICONS, key) ? (PLUGIN_PANEL_ICONS[key] ?? Puzzle) : Puzzle
}
