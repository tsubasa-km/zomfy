import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Whether two form values hold the same data: plain objects compared by content (key order ignored,
 * an `undefined` key the same as a missing one), arrays in order, everything else with Object.is.
 */
export function sameFormValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
    return a.every((item, i) => sameFormValue(item, b[i]))
  }
  if (!isPlainObject(a) || !isPlainObject(b)) return false
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  for (const key of keys) if (!sameFormValue(a[key], b[key])) return false
  return true
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

export interface SaveState {
  /** The form holds something other than what was saved. */
  dirty: boolean
  /** The save is running. */
  saving: boolean
  /**
   * A save just succeeded (for a couple of seconds), for screens that stay open after it. Show it
   * with `!dirty`: once the form changes again, what it shows is not saved any more.
   */
  justSaved: boolean
  /** Runs the save, once at a time; a failure is the action's to report (it throws or returns false). */
  save: () => Promise<boolean>
}

const JUST_SAVED_MS = 2000

/**
 * A form's explicit Save step: whether it has anything to save (what the form holds against what
 * was saved), whether it is saving, and a moment's "Saved" after it did. `action` resolves false
 * (or throws) when the save failed; the form shows why itself.
 */
export function useSaveState<T>(saved: T, current: T, action: () => Promise<boolean | void>): SaveState {
  const [saving, setSaving] = useState(false)
  const [justSaved, setJustSaved] = useState(false)
  const running = useRef(false)
  const mounted = useRef(true)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const latest = useRef(action)
  latest.current = action
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      if (timer.current) clearTimeout(timer.current)
    }
  }, [])
  const dirty = !sameFormValue(saved, current)

  const save = useCallback(async (): Promise<boolean> => {
    if (running.current) return false
    running.current = true
    setSaving(true)
    let ok = false
    try {
      ok = (await latest.current()) !== false
    } catch {
      ok = false
    } finally {
      running.current = false
      if (mounted.current) setSaving(false)
    }
    if (ok && mounted.current) {
      setJustSaved(true)
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => mounted.current && setJustSaved(false), JUST_SAVED_MS)
    }
    return ok
  }, [])

  return { dirty, saving, justSaved, save }
}
