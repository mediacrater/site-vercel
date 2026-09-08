"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Shield, CheckCircle, ArrowUpRight } from "lucide-react"

const SIGNUP_LINK =
  "https://mediacrater.com/signup"

export function Hero() {
  const [hasChanged, setHasChanged] = useState(false)
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false)

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)")
    setPrefersReducedMotion(mediaQuery.matches)

    // Reduced-motion visitors get a short, plain hold instead of the
    // full 3s read-time for a slide they won't see play out.
    const timer = window.setTimeout(
      () => setHasChanged(true),
      mediaQuery.matches ? 400 : 3000
    )
    return () => window.clearTimeout(timer)
  }, [])

  return (
    <section className="relative overflow-hidden border-b border-border/50 pt-28 pb-20 md:pt-36 md:pb-28">
      {/* Very subtle background treatment */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0"
      >
        <div className="absolute left-[8%] top-[12%] h-64 w-64 rounded-full bg-primary/5 blur-3xl" />
        <div className="absolute right-[8%] top-[18%] h-72 w-72 rounded-full bg-accent/5 blur-3xl" />
      </div>

      <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="grid items-center gap-14 lg:grid-cols-12 lg:gap-10">
          {/* Copy */}
          <div className="lg:col-span-6">
            <Badge
              variant="outline"
              className="mb-7 rounded-full border-primary/25 bg-primary/5 px-3 py-1.5 text-xs font-semibold text-primary"
            >
              <span className="mr-2 h-1.5 w-1.5 rounded-full bg-primary" />
              Video ad policy checker
            </Badge>

            <h1
              aria-label="Know before you launch."
              className="max-w-3xl font-[family-name:var(--font-display)] text-5xl font-bold leading-[0.98] tracking-[-0.035em] text-foreground sm:text-6xl lg:text-7xl"
            >
              <span className="inline-flex items-baseline">
                {prefersReducedMotion ? (
                  // Reduced motion: both words stacked in the same grid
                  // cell, swapped with opacity only — no sliding, no
                  // animated width.
                  <span
                    aria-hidden="true"
                    className="relative inline-grid h-[1.05em] shrink-0 translate-y-[0.16em] items-baseline"
                  >
                    <span
                      className={`col-start-1 row-start-1 flex h-[1.05em] shrink-0 items-center whitespace-nowrap transition-opacity duration-300 ease-out ${
                        hasChanged ? "opacity-100" : "opacity-0"
                      }`}
                    >
                      Know
                    </span>
                    <span
                      className={`col-start-1 row-start-1 flex h-[1.05em] shrink-0 items-center whitespace-nowrap transition-opacity duration-300 ease-out ${
                        hasChanged ? "opacity-0" : "opacity-100"
                      }`}
                    >
                      Question
                    </span>
                  </span>
                ) : (
                  // Original slide/reveal — untouched.
                  <span
                    aria-hidden="true"
                    className="relative inline-block h-[1.05em] shrink-0 translate-y-[0.16em] overflow-hidden transition-[width] duration-[2500ms] ease-[cubic-bezier(0.22,1,0.36,1)]"
                    style={{
                      width: hasChanged ? "2.75em" : "4.35em",
                    }}
                  >
                    <span
                      className="absolute inset-x-0 top-0 flex h-[2.1em] flex-col transition-transform duration-[2500ms] ease-[cubic-bezier(0.22,1,0.36,1)]"
                      style={{
                        transform: hasChanged
                          ? "translateY(0)"
                          : "translateY(-1.05em)",
                      }}
                    >
                      <span className="flex h-[1.05em] shrink-0 items-center">
                        Know
                      </span>
                      <span className="flex h-[1.05em] shrink-0 items-center">
                        Question
                      </span>
                    </span>
                  </span>
                )}
                <span className="ml-[0.18em]">before</span>
              </span>
              <br />
              you <span className="text-primary">launch</span>
              {prefersReducedMotion ? (
                <span
                  aria-hidden="true"
                  className="relative ml-[0.02em] inline-grid h-[1.05em] translate-y-[0.16em] items-baseline"
                >
                  <span
                    className={`col-start-1 row-start-1 flex h-[1.05em] shrink-0 items-center whitespace-nowrap transition-opacity duration-300 ease-out ${
                      hasChanged ? "opacity-100" : "opacity-0"
                    }`}
                  >
                    .
                  </span>
                  <span
                    className={`col-start-1 row-start-1 flex h-[1.05em] shrink-0 items-center whitespace-nowrap transition-opacity duration-300 ease-out ${
                      hasChanged ? "opacity-0" : "opacity-100"
                    }`}
                  >
                    ..?
                  </span>
                </span>
              ) : (
                <span
                  aria-hidden="true"
                  className="relative ml-[0.02em] inline-block h-[1.05em] translate-y-[0.16em] overflow-hidden transition-[width] duration-[2500ms] ease-[cubic-bezier(0.22,1,0.36,1)]"
                  style={{
                    width: hasChanged ? "0.3em" : "1.1em",
                  }}
                >
                  <span
                    className="absolute inset-x-0 top-0 flex h-[2.1em] flex-col transition-transform duration-[2500ms] ease-[cubic-bezier(0.22,1,0.36,1)]"
                    style={{
                      transform: hasChanged
                        ? "translateY(0)"
                        : "translateY(-1.05em)",
                    }}
                  >
                    <span className="flex h-[1.05em] shrink-0 items-center">
                      .
                    </span>
                    <span className="flex h-[1.05em] shrink-0 items-center">
                      ..?
                    </span>
                  </span>
                </span>
              )}
            </h1>

            <p className="mt-7 max-w-xl text-lg leading-relaxed text-muted-foreground sm:text-xl">
              Scan your video ads for potential Meta, TikTok, and Google
              policy issues before you spend money promoting them.
            </p>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Button
                asChild
                size="lg"
                className="h-12 rounded-xl bg-primary px-6 text-base font-semibold text-primary-foreground shadow-sm hover:bg-primary/90"
              >
                <a
                  href={SIGNUP_LINK}
                >
                  <Shield className="mr-2 h-4 w-4" />
                  Try it free
                  <ArrowUpRight className="ml-1 h-4 w-4" />
                </a>
              </Button>

              <Button
                asChild
                variant="outline"
                size="lg"
                className="h-12 rounded-xl bg-background px-6 text-base"
              >
                <a
                  href="https://www.youtube.com/watch?v=Jk_XtsN1N9I&utm_medium=website_hero"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  See how it works
                </a>
              </Button>
            </div>

            <div className="mt-8 flex flex-wrap gap-x-6 gap-y-3 text-sm text-muted-foreground">
              <div className="flex items-center gap-2">
                <CheckCircle className="h-4 w-4 text-emerald-500" />
                Privacy-first processing
              </div>

              <div className="flex items-center gap-2">
                <CheckCircle className="h-4 w-4 text-emerald-500" />
                Multi-platform support
              </div>

              <div className="flex items-center gap-2">
                <CheckCircle className="h-4 w-4 text-emerald-500" />
                Audio analysis
              </div>
            </div>

            <div className="mt-10 border-t border-border/60 pt-5">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/60">
                Check creatives for
              </p>

              <div className="mt-3 flex flex-wrap gap-2">
                {["Meta", "TikTok", "YouTube", "X", "Pinterest"].map(
                  (platform) => (
                    <span
                      key={platform}
                      className="rounded-md border border-border bg-secondary/50 px-2.5 py-1 text-xs font-medium text-muted-foreground"
                    >
                      {platform}
                    </span>
                  )
                )}
              </div>
            </div>
          </div>

          {/* Product visual */}
          <div className="relative lg:col-span-6">
            <div className="absolute -inset-6 rounded-[2rem] bg-primary/5 blur-3xl" />

            <div className="relative overflow-hidden rounded-2xl border border-border bg-card shadow-2xl">
              {/* Browser chrome */}
              <div className="flex items-center justify-between border-b border-border bg-muted/40 px-4 py-3">
                <div className="flex items-center gap-1.5">
                  <div className="h-2.5 w-2.5 rounded-full bg-destructive/50" />
                  <div className="h-2.5 w-2.5 rounded-full bg-amber-500/50" />
                  <div className="h-2.5 w-2.5 rounded-full bg-emerald-500/50" />
                </div>

                <span className="text-[10px] font-mono text-muted-foreground">
                  mediacrater.com / scan
                </span>

                <div className="w-10" />
              </div>

              <div className="grid gap-4 p-4 sm:p-5">
                {/* Video */}
                <div className="relative aspect-video overflow-hidden rounded-xl bg-black">
                  <div className="absolute inset-0 bg-gradient-to-br from-slate-800 via-slate-950 to-black" />

                  <div className="absolute left-5 top-5 rounded-md border border-white/10 bg-black/40 px-2.5 py-1.5 text-[10px] font-mono text-white/70 backdrop-blur">
                    compliance_audit.mp4
                  </div>

                  <div className="absolute bottom-5 left-5">
                    <p className="text-xs font-medium text-white/50">
                      00:12 / 00:31
                    </p>
                    <div className="mt-2 h-1 w-48 overflow-hidden rounded-full bg-white/20">
                      <div className="h-full w-[39%] rounded-full bg-primary" />
                    </div>
                  </div>

                  <div className="absolute right-5 top-5 rounded-full bg-amber-500/15 px-2.5 py-1 text-[10px] font-semibold text-amber-400 ring-1 ring-inset ring-amber-500/20">
                    1 issue
                  </div>
                </div>

                {/* Assessment */}
                <div className="rounded-xl border border-border bg-background p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                        Analysis Results
                      </p>
                      <p className="mt-1 text-xl font-bold text-foreground">
                        META
                      </p>
                    </div>

                    <div className="text-right">
                      <p className="font-mono text-sm font-semibold text-amber-500">
                        Medium risk
                      </p>
                    </div>
                  </div>

                  <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-muted">
                    <div className="h-full w-[52%] rounded-full bg-amber-500" />
                  </div>

                  <div className="mt-4 rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
                    <div className="flex gap-3">
                      <div className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-amber-500" />

                      <div>
                        <p className="text-xs font-semibold text-foreground">
                          Timestamp 0:12 — Soft guarantee claim
                        </p>
                        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                          Potential policy issue detected. Review the phrasing
                          before publishing.
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="mt-3 flex items-center justify-between border-t border-border pt-3 text-[10px] text-muted-foreground">
                    <span>Deep scan</span>
                    <span className="font-mono text-primary">
                      analysis complete
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
