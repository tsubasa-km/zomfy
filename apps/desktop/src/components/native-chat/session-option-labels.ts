import type { ChatEffort, ChatModel, SessionOptions } from '@zomfy/protocol'
import { t } from '@/i18n/i18n'

// How the composer names a Claude chat's model and effort (docs/specs/composer-effort.md).

export const EFFORT_LABEL: Record<ChatEffort, string> = {
  low: t('Low'),
  medium: t('Medium'),
  high: t('High'),
  xhigh: t('Extra high'),
  max: t('Max')
}
export const EFFORT_SHORT: Record<ChatEffort, string> = { low: t('Low'), medium: t('Med'), high: t('High'), xhigh: t('XHigh'), max: t('Max') }
/** The CLI's own default, shown when the session names none. */
export const DEFAULT_MODEL = 'default'
/** The effort row's choice that leaves the level to Claude. */
export const DEFAULT_EFFORT = 'default'

/** What Claude's default effort resolved to on the chat's last turn (SessionInfo.defaultEffort). */
export type DefaultEffort = { model: string | null; effort: ChatEffort } | null | undefined

export function currentChoice(
  options: SessionOptions,
  models: ChatModel[],
  defaultEffort?: DefaultEffort
): { value: string; model: ChatModel | undefined; effort: ChatEffort | null; resolved: ChatEffort | null } {
  const value = options.model ?? models.find((m) => m.value === DEFAULT_MODEL)?.value ?? DEFAULT_MODEL
  const model = models.find((m) => m.value === value)
  // Before the model list arrives, a picked level is shown as it is.
  const effort = options.effort && (!model || model.efforts.includes(options.effort)) ? options.effort : null
  // The default seen on a turn counts only while the chat's model option is the one it ran with.
  const seen = defaultEffort && defaultEffort.model === options.model ? defaultEffort.effort : null
  const resolved = !effort && seen && model?.efforts.includes(seen) ? seen : null
  return { value, model, effort, resolved }
}

/**
 * How the menu's trigger names Claude's options: the model (null when nothing names one), its
 * effort (a picked level, the level the default resolved to, or Default), and both as a screen
 * reader hears them.
 */
export function sessionOptionLabels(
  options: SessionOptions,
  models: ChatModel[],
  defaultEffort?: DefaultEffort
): { model: string | null; effort: string | null; spoken: string } {
  const { model, effort, resolved } = currentChoice(options, models, defaultEffort)
  const name = model?.displayName ?? options.model
  const spoken = name ?? t('Model')
  if (effort) {
    return { model: name, effort: EFFORT_SHORT[effort], spoken: t('Model {model}, Effort {effort}', { model: spoken, effort: EFFORT_LABEL[effort] }) }
  }
  if (!model?.efforts.length) return { model: name, effort: null, spoken: t('Model {model}', { model: spoken }) }
  if (resolved) {
    return {
      model: name,
      effort: t('{effort} (default)', { effort: EFFORT_SHORT[resolved] }),
      spoken: t("Model {model}, Effort {effort}, Claude's default", { model: spoken, effort: EFFORT_LABEL[resolved] })
    }
  }
  return { model: name, effort: t('Default'), spoken: t("Model {model}, Effort Claude's default", { model: spoken }) }
}
