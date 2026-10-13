//components/tools/tool-page-shell.tsx
import Link from "next/link"
import type { ReactNode } from "react"
import { Header } from "@/components/header"
import { Footer } from "@/components/footer"
import { JsonLd } from "@/components/tools/json-ld"
import { liveTools, type ToolDef } from "@/lib/tools/registry"
import { signupUrl } from "@/lib/tools/cta"

const SITE = "https://mediacrater.com"

interface ToolPageShellProps {
  tool: ToolDef
  intro: string
  children: ReactNode // the interactive client component
  method: ReactNode // how it works + official sources
  limits: string[]
  faqs: { q: string; a: string }[]
}

export function ToolPageShell({ tool, intro, children, method, limits, faqs }: ToolPageShellProps) {
  const url = `${SITE}/tools/${tool.slug}`
  const related = liveTools().filter((t) => t.slug !== tool.slug).slice(0, 4)

  return (
    <>
      <Header />
      <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <JsonLd
          data={{
            "@context": "https://schema.org",
            "@graph": [
              {
                "@type": "WebApplication",
                name: tool.name,
                url,
                description: tool.description,
                applicationCategory: "BusinessApplication",
                operatingSystem: "Any (web browser)",
                isAccessibleForFree: true,
                offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
                publisher: { "@type": "Organization", name: "Mediacrater", url: SITE },
              },
              {
                "@type": "BreadcrumbList",
                itemListElement: [
                  { "@type": "ListItem", position: 1, name: "Home", item: SITE },
                  { "@type": "ListItem", position: 2, name: "Free tools", item: `${SITE}/tools` },
                  { "@type": "ListItem", position: 3, name: tool.name, item: url },
                ],
              },
            ],
          }}
        />

        <nav aria-label="Breadcrumb" className="text-xs text-muted-foreground">
          <Link href="/tools" className="hover:underline">Free tools</Link> / {tool.name}
        </nav>

        <h1 className="mt-3 font-[family-name:var(--font-display)] text-3xl font-bold tracking-[-0.03em] sm:text-4xl">
          {tool.name}
        </h1>
        <p className="mt-3 text-muted-foreground">{intro}</p>
        <p className="mt-2 text-xs text-muted-foreground">
          Runs in your browser. Your text and files are never uploaded.
        </p>

        <section aria-label="Tool" className="mt-8">{children}</section>

        <section className="mt-10 rounded-xl border border-border bg-card p-6">
          <p className="font-semibold">{tool.ctaText}</p>
          <Link
            href={signupUrl(tool.slug)}
            className="mt-4 inline-flex w-full items-center justify-center rounded-lg bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground hover:opacity-90 sm:w-auto"
          >
            Scan your creative with Mediacrater
          </Link>
          <p className="mt-2 text-xs text-muted-foreground">3 free scans every month. No credit card.</p>
        </section>

        <section className="mt-12">
          <h2 className="text-xl font-bold">How it works</h2>
          <div className="mt-3 space-y-3 text-sm leading-relaxed text-muted-foreground">{method}</div>
          <p className="mt-3 text-xs text-muted-foreground">
            Last checked against official sources: {tool.lastVerified}
          </p>
        </section>

        <section className="mt-10">
          <h2 className="text-xl font-bold">Limitations</h2>
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
            {limits.map((l) => <li key={l}>{l}</li>)}
          </ul>
        </section>

        <section className="mt-10">
          <h2 className="text-xl font-bold">FAQ</h2>
          <div className="mt-3 divide-y divide-border border-y border-border">
            {faqs.map((f) => (
              <details key={f.q} className="py-3">
                <summary className="cursor-pointer text-sm font-medium">{f.q}</summary>
                <p className="mt-2 text-sm text-muted-foreground">{f.a}</p>
              </details>
            ))}
          </div>
        </section>

        {related.length > 0 && (
          <section className="mt-10">
            <h2 className="text-xl font-bold">More free tools</h2>
            <ul className="mt-3 grid gap-2 sm:grid-cols-2">
              {related.map((t) => (
                <li key={t.slug}>
                  <Link href={`/tools/${t.slug}`} className="block rounded-lg border border-border p-3 text-sm hover:bg-card">
                    {t.name}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
      <Footer />
    </>
  )
}
