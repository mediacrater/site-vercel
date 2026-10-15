//components/promotion/sticky-cta.tsx
"use client"

import { useEffect, useState } from "react"
import { SignupCta } from "@/components/promotion/signup-cta"

// The bar is hidden while either of these elements is on screen, so it never
// shows next to a CTA the visitor can already see.
const HIDE_WHILE_VISIBLE = ["hero-cta", "final-cta"]

export function StickyCta() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return

    const targets = HIDE_WHILE_VISIBLE.map((id) => document.getElementById(id)).filter(
      (el): el is HTMLElement => el !== null,
    )
    if (targets.length === 0) return

    const inView = new Set<Element>()
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) inView.add(entry.target)
        else inView.delete(entry.target)
      }
      setVisible(inView.size === 0)
    })

    targets.forEach((el) => observer.observe(el))
    return () => observer.disconnect()
  }, [])

  // Not rendered at all when hidden, so it can't be reached by keyboard or screen reader.
  if (!visible) return null

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 flex justify-center border-t border-border bg-background/95 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur md:hidden">
      <SignupCta position="sticky" label="Scan your first ad free" className="w-full max-w-md" />
    </div>
  )
}
