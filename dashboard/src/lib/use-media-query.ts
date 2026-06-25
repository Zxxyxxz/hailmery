import { useEffect, useState } from 'react'

/**
 * Subscribe to a CSS media query. Initialises from the current match (this is a
 * client-only SPA, so window.matchMedia is always available at mount).
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia(query).matches : false,
  )

  useEffect(() => {
    const mql = window.matchMedia(query)
    const onChange = () => setMatches(mql.matches)
    onChange()
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [query])

  return matches
}

/** True below the md breakpoint (Tailwind md = 768px). */
export function useIsMobile(): boolean {
  return useMediaQuery('(max-width: 767px)')
}
