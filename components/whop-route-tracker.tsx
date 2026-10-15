//components/whop-route-tracker.tsx
"use client"

import { useEffect, useRef } from "react"
import { usePathname } from "next/navigation"

type WhopPixel = { track: (...args: unknown[]) => void }

// Next.js changes pages without a full reload, and the Whop snippet only
// sends "page" once per full load. This sends one more "page" per client-side
// route change. It does nothing if the pixel isn't loaded (flag off, ad blocker).
export function WhopRouteTracker() {
  const pathname = usePathname()
  const previous = useRef<string | null>(null)

  useEffect(() => {
    // The first page view is already sent by the pixel snippet itself.
    if (previous.current !== null && previous.current !== pathname) {
      const whop = (window as unknown as { whop?: WhopPixel }).whop
      whop?.track("page")
    }
    previous.current = pathname
  }, [pathname])

  return null
}
