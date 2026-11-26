import { useEffect, useState } from 'react'

/**
 * True once `on` has held for `ms` without a break. For a notice about a brief state (a host
 * connecting at startup) that should show only when the state lasts long enough to matter.
 */
export function useLasting(on: boolean, ms: number): boolean {
  const [lasted, setLasted] = useState(false)
  useEffect(() => {
    if (!on) {
      setLasted(false)
      return
    }
    const timer = setTimeout(() => setLasted(true), ms)
    return () => clearTimeout(timer)
  }, [on, ms])
  return on && lasted
}
