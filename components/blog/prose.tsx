//components/blog/prose.tsx
// Typed building blocks for post bodies. Using these instead of raw HTML keeps
// every post styled the same and avoids rendering untrusted HTML strings.
import type { ReactNode } from "react"
import Link from "next/link"

export function H2({ id, children }: { id: string; children: ReactNode }) {
  return (
    <h2
      id={id}
      className="mt-12 scroll-mt-24 font-[family-name:var(--font-display)] text-2xl font-bold tracking-[-0.02em] text-foreground"
    >
      {children}
    </h2>
  )
}

export function H3({ children }: { children: ReactNode }) {
  return <h3 className="mt-8 text-lg font-semibold text-foreground">{children}</h3>
}

export function P({ children }: { children: ReactNode }) {
  return <p className="mt-4 text-[1.0625rem] leading-[1.75] text-foreground/90">{children}</p>
}

export function UL({ children }: { children: ReactNode }) {
  return <ul className="mt-4 list-disc space-y-2 pl-6 text-[1.0625rem] leading-[1.75] text-foreground/90">{children}</ul>
}

export function LI({ children }: { children: ReactNode }) {
  return <li className="pl-1">{children}</li>
}

/**
 * Internal links use next/link. External links open safely in a new tab.
 * Set `sponsored` on affiliate or paid links: Google requires rel="sponsored" on them.
 */
export function A({ href, sponsored = false, children }: { href: string; sponsored?: boolean; children: ReactNode }) {
  const className = "font-medium text-primary underline underline-offset-4 hover:opacity-80"
  if (href.startsWith("/") && !sponsored) {
    return <Link href={href} className={className}>{children}</Link>
  }
  const rel = sponsored ? "sponsored noopener noreferrer" : "noopener noreferrer"
  return (
    <a href={href} className={className} target="_blank" rel={rel}>
      {children}
    </a>
  )
}

export function Callout({ title, children }: { title: string; children: ReactNode }) {
  return (
    <aside className="mt-6 rounded-xl border border-border bg-card p-5">
      <p className="font-semibold text-foreground">{title}</p>
      <div className="mt-2 text-sm leading-relaxed text-muted-foreground">{children}</div>
    </aside>
  )
}

/**
 * A fact only the author knows. Renders as a bright highlight so it can't be
 * missed. Replace every <Fill> with real text before setting the post to "live".
 */
export function Fill({ children }: { children: ReactNode }) {
  return (
    <mark className="rounded bg-yellow-200 px-1 text-neutral-900" title="Replace before publishing">
      [{children}]
    </mark>
  )
}
