//app/tools/page.tsx
import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { Header } from "@/components/header"
import { Footer } from "@/components/footer"
import { liveTools } from "@/lib/tools/registry"

export const metadata: Metadata = {
  title: "Free Ad Creative & Policy Tools | Mediacrater",
  description: "Free, no-signup tools for media buyers: ad copy policy checks, safe zones, spec checks and more. Everything runs in your browser.",
  alternates: { canonical: "/tools" },
}

export default function ToolsHub() {
  const tools = liveTools()
  if (tools.length === 0) notFound() // never publish an empty hub

  return (
    <>
      <Header />
       <main className="mx-auto max-w-5xl px-4 pt-28 pb-12 sm:px-6">
        <h1 className="font-[family-name:var(--font-display)] text-4xl font-bold tracking-[-0.035em]">Free tools for media buyers</h1>
        <p className="mt-3 max-w-2xl text-muted-foreground">No signup. Your files and text stay on your device.</p>
        <ul className="mt-10 grid gap-4 sm:grid-cols-2">
          {tools.map((t) => (
            <li key={t.slug}>
              <Link href={`/tools/${t.slug}`} className="block h-full rounded-xl border border-border bg-card p-5 hover:border-primary">
                <h2 className="font-semibold">{t.name}</h2>
                <p className="mt-2 text-sm text-muted-foreground">{t.description}</p>
              </Link>
            </li>
          ))}
        </ul>
      </main>
      <Footer />
    </>
  )
}
