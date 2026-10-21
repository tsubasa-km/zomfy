import { useEffect, useState } from 'react'

/** Tracks the app theme so Monaco can follow it, as Orca switches 'vs' / 'vs-dark'. */
export function useDarkClass(): boolean {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'))
  useEffect(() => {
    const observer = new MutationObserver(() => setDark(document.documentElement.classList.contains('dark')))
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    return () => observer.disconnect()
  }, [])
  return dark
}

export const EDITOR_FONT_FAMILY = 'Cascadia Code, Consolas, ui-monospace, monospace'
