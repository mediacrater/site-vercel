//components/promotion/signup-cta.tsx
"use client"
// Signup button for /promotion.
// Forwards ad attribution params (utm_*, fbclid, ttclid, gclid) from the
// landing URL to /signup so paid-traffic attribution isn't dropped at the
// funnel's most important step.
//
// Security:
// - The destination path is a constant ("/signup"), never read from the URL,
//   so this can't be turned into an open redirect.
// - Only allow-listed keys are copied. Values must match a strict character
//   set and length cap; anything else is dropped, not "cleaned".
// - URLSearchParams handles encoding.
import { useEffect, useState } from "react"
import { ArrowRight } from "lucide-react"

type Position = "hero" | "mid" | "final" | "sticky"

const SIGNUP_PATH = "/signup"

const FORWARDED_KEYS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
  "fbclid",
  "ttclid",
  "gclid",
] as const

// Letters/numbers in any language, plus the separators ad platforms use.
const SAFE_VALUE = /^[\p{L}\p{N} _\-.~:|+]{1,200}$/u

function buildHref(search: string, position: Position): string {
  const out = new URLSearchParams({
    src: `promotion-${position}`,
    utm_source: "website",
    utm_medium: "landing",
    utm_campaign: "promotion",
  })

  const incoming = new URLSearchParams(search)
  for (const key of FORWARDED_KEYS) {
    const value = incoming.get(key)
    if (value && SAFE_VALUE.test(value)) out.set(key, value) // ad's own UTMs win
  }

  return `${SIGNUP_PATH}?${out.toString()}`
}

export function SignupCta({
  position,
  label = "Create a free account",
  className = "",
}: {
  position: Position
  label?: string
  className?: string
}) {
  // Server render uses the defaults; the browser upgrades it with the ad's params.
  const [href, setHref] = useState(() => buildHref("", position))

  useEffect(() => {
    setHref(buildHref(window.location.search, position))
  }, [position])

  return (
    <a
      href={href}
      className={`inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-primary px-6 text-base font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${className}`}
    >
      {label}
      <ArrowRight aria-hidden="true" className="h-4 w-4" />
    </a>
  )
}
