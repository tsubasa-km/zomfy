import { useState, type ReactNode } from 'react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import { SearchableSetting } from './SettingsSection'
import { t } from '@/i18n/i18n'

// Orca's settings row grammar (components/settings/SettingsFormControls.tsx): label and
// description on the left, a shrink-0 control on the right. Rows take part in settings search.

export function SettingsRow({
  label,
  description,
  keywords,
  control,
  alignTop
}: {
  label: string
  description?: ReactNode
  keywords?: readonly string[]
  control: ReactNode
  alignTop?: boolean
}) {
  return (
    <SearchableSetting entry={{ title: label, description: typeof description === 'string' ? description : undefined, keywords }}>
      <div
        className={cn(
          'flex gap-4',
          description ? 'py-3' : 'py-2',
          alignTop ? 'items-start' : 'items-center justify-between'
        )}
      >
        <div className={cn('min-w-0 flex-1', description ? 'space-y-1' : 'space-y-0.5')}>
          <Label className="select-text">{label}</Label>
          {description ? <p className="text-xs text-muted-foreground select-text">{description}</p> : null}
        </div>
        <div className="shrink-0">{control}</div>
      </div>
    </SearchableSetting>
  )
}

export function SettingsSwitchRow({
  label,
  description,
  keywords,
  checked,
  onChange,
  disabled
}: {
  label: string
  description?: string
  keywords?: readonly string[]
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
}) {
  return (
    <SettingsRow
      label={label}
      description={description}
      keywords={keywords}
      control={<Switch checked={checked} disabled={disabled} aria-label={label} onCheckedChange={onChange} />}
    />
  )
}

/** Orca's canonical segmented control for theme, cursor style and similar small choices. */
export function SettingsSegmentedControl<T extends string | number>({
  value,
  onChange,
  options,
  ariaLabel,
  size = 'md'
}: {
  value: T
  onChange: (value: T) => void
  options: readonly { value: T; label: ReactNode }[]
  ariaLabel?: string
  size?: 'sm' | 'md'
}) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className="inline-flex items-center rounded-md border border-border bg-background/50 p-0.5">
      {options.map((option) => {
        const active = option.value === value
        return (
          <button
            key={String(option.value)}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(option.value)}
            className={cn(
              'rounded-sm text-center outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50',
              size === 'sm' ? 'px-2.5 py-0.5 text-xs' : 'px-3 py-1 text-sm',
              active ? 'bg-accent font-medium text-accent-foreground' : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

export function SettingsSubsectionHeader({
  title,
  description,
  action,
  className
}: {
  title: ReactNode
  description?: ReactNode
  action?: ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex items-start justify-between gap-3', className)}>
      <div className="space-y-1">
        <h3 className="text-sm font-semibold">{title}</h3>
        {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  )
}

/** Commits on blur or Enter, clamped; an invalid entry snaps back to the current value. */
export function NumberField({
  label,
  description,
  keywords,
  value,
  defaultValue,
  min,
  max,
  step = 1,
  suffix,
  onChange
}: {
  label: string
  description?: string
  keywords?: readonly string[]
  value: number
  defaultValue?: number
  min: number
  max: number
  step?: number
  suffix?: string
  onChange: (value: number) => void
}) {
  const [draft, setDraft] = useState(String(value))
  const [previous, setPrevious] = useState(value)
  if (value !== previous) {
    setPrevious(value)
    setDraft(String(value))
  }
  const commit = () => {
    const next = Number(draft.trim())
    if (draft.trim() === '' || !Number.isFinite(next)) {
      setDraft(String(value))
      return
    }
    const clamped = Math.min(max, Math.max(min, next))
    onChange(clamped)
    setDraft(String(clamped))
  }
  return (
    <SettingsRow
      label={label}
      keywords={keywords}
      description={
        description || defaultValue !== undefined ? (
          <>
            {description}
            {defaultValue !== undefined ? <span className="ml-1 text-muted-foreground/70">{t('· Default: {value}', { value: defaultValue })}</span> : null}
          </>
        ) : undefined
      }
      control={
        <div className="flex items-center gap-2">
          <Input
            type="number"
            min={min}
            max={max}
            step={step}
            aria-label={label}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit()
            }}
            className="w-24 tabular-nums"
          />
          {suffix ? <span className="shrink-0 text-xs text-muted-foreground">{suffix}</span> : null}
        </div>
      }
    />
  )
}

/** Free text (font names, paths) committed on blur or Enter; empty means "use the default". */
export function TextField({
  label,
  description,
  keywords,
  value,
  placeholder,
  onChange,
  className,
  type
}: {
  label: string
  description?: string
  keywords?: readonly string[]
  value: string
  placeholder?: string
  onChange: (value: string) => void
  className?: string
  /** 'password' masks secrets such as API keys. */
  type?: 'text' | 'password'
}) {
  const [draft, setDraft] = useState(value)
  const [previous, setPrevious] = useState(value)
  if (value !== previous) {
    setPrevious(value)
    setDraft(value)
  }
  const commit = () => {
    if (draft.trim() !== value) onChange(draft.trim())
  }
  return (
    <SettingsRow
      label={label}
      description={description}
      keywords={keywords}
      control={
        <Input
          aria-label={label}
          type={type}
          value={draft}
          placeholder={placeholder}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit()
          }}
          className={cn('w-60 text-sm', className)}
        />
      }
    />
  )
}
