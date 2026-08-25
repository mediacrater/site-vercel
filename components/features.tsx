"use client"

import {
  AlertTriangle,
  CheckCircle,
  Lock,
  Play,
} from "lucide-react"
import { useState, useEffect } from "react"

function PolicyEngineVisual() {
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-background shadow-lg">
      <div className="flex items-center justify-between border-b border-border bg-muted/30 px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="h-2.5 w-2.5 rounded-full bg-red-400/60" />
          <div className="h-2.5 w-2.5 rounded-full bg-amber-400/60" />
          <div className="h-2.5 w-2.5 rounded-full bg-emerald-400/60" />
        </div>

        <span className="font-mono text-[10px] text-muted-foreground">
          policy_engine
        </span>
      </div>

      <div className="grid md:grid-cols-[1.1fr_0.9fr]">
        {/* Video side */}
        <div className="relative min-h-[260px] bg-black">
          <div className="absolute inset-0 bg-gradient-to-br from-slate-800 via-slate-950 to-black" />

          <div className="absolute left-5 top-5 rounded-md bg-white/5 px-2 py-1 text-[10px] font-mono text-white/60">
            creative_042.mp4
          </div>

          <div className="absolute bottom-5 left-5 right-5">
            <div className="mb-2 flex justify-between text-[10px] text-white/40">
              <span>00:12</span>
              <span>00:31</span>
            </div>

            <div className="h-1 rounded-full bg-white/10">
              <div className="h-full w-[40%] rounded-full bg-primary" />
            </div>
          </div>

          <div className="absolute right-5 top-5 rounded-full bg-amber-500/10 px-2.5 py-1 text-[10px] font-medium text-amber-400 ring-1 ring-inset ring-amber-500/20">
            Review needed
          </div>
        </div>

        {/* Results */}
        <div className="p-5">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Platform checks
          </p>

          <div className="mt-4 space-y-2">
            <div className="flex items-center justify-between rounded-lg border border-border p-3">
              <span className="text-xs font-medium text-foreground">
                Meta
              </span>
              <span className="text-[10px] font-semibold text-emerald-500">
                PASS
              </span>
            </div>

            <div className="flex items-center justify-between rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
              <span className="text-xs font-medium text-foreground">
                TikTok
              </span>
              <span className="text-[10px] font-semibold text-amber-500">
                REVIEW
              </span>
            </div>

            <div className="flex items-center justify-between rounded-lg border border-border p-3">
              <span className="text-xs font-medium text-foreground">
                YouTube
              </span>
              <span className="text-[10px] font-semibold text-emerald-500">
                PASS
              </span>
            </div>
          </div>

          <div className="mt-4 rounded-lg border border-border bg-muted/30 p-3">
            <p className="text-[10px] font-semibold text-foreground">
              1 potential issue
            </p>

            <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">
              Timestamp 0:12 contains a claim that may require review.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

function FixVisual() {
  const [step, setStep] = useState(0)

  useEffect(() => {
    const timer = setInterval(() => {
      setStep((current) => (current + 1) % 2)
    }, 2500)

    return () => clearInterval(timer)
  }, [])

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-background shadow-lg">
      <div className="border-b border-border bg-muted/30 px-4 py-3">
        <span className="font-mono text-[10px] text-muted-foreground">
          suggested_fix
        </span>
      </div>

      <div className="p-5">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive ring-1 ring-inset ring-destructive/20">
            <AlertTriangle className="h-3.5 w-3.5" />
            Potential violation
          </div>

          <div className="h-px flex-1 bg-border" />

          <CheckCircle className="h-4 w-4 text-emerald-500" />
        </div>

        <div className="mt-5 space-y-3 font-mono text-xs">
          <div
            className={`rounded-lg border p-3 transition-all duration-500 ${
              step === 0
                ? "border-destructive/20 bg-destructive/5 text-destructive"
                : "border-border bg-muted/30 text-muted-foreground/50"
            }`}
          >
            “Lose 10lbs in 7 days!”
          </div>

          <div className="flex justify-center text-muted-foreground">
            ↓
          </div>

          <div
            className={`rounded-lg border p-3 transition-all duration-500 ${
              step === 1
                ? "border-emerald-500/20 bg-emerald-500/5 text-emerald-600 dark:text-emerald-400"
                : "border-border bg-muted/30 text-muted-foreground/50"
            }`}
          >
            “Support your wellness journey”
          </div>
        </div>

        <div className="mt-5 border-t border-border pt-4">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Why
          </p>

          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            Replace potentially problematic guarantees with language that
            avoids an unsupported outcome claim.
          </p>
        </div>
      </div>
    </div>
  )
}

export function Features() {
  return (
    <section
      id="features"
      className="border-b border-border/50 bg-secondary/20 py-24 md:py-32"
    >
      <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
        <div className="max-w-2xl">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-primary">
            The policy engine
          </p>

          <h2 className="mt-3 font-[family-name:var(--font-display)] text-4xl font-bold leading-tight tracking-tight text-foreground sm:text-5xl">
            See what needs attention before the platform does.
          </h2>

          <p className="mt-5 text-lg leading-relaxed text-muted-foreground">
            Mediacrater looks at your creative against platform-specific
            policies, identifies potential risk zones, and gives you something
            useful to act on.
          </p>
        </div>

        {/* Feature 1 */}
        <div className="mt-20 grid items-center gap-10 lg:grid-cols-12 lg:gap-16">
          <div className="lg:col-span-5">
            <p className="font-mono text-xs text-primary">01</p>

            <h3 className="mt-3 font-[family-name:var(--font-display)] text-3xl font-bold tracking-tight text-foreground">
              One creative.
              <br />
              Multiple policy checks.
            </h3>

            <p className="mt-5 text-base leading-relaxed text-muted-foreground">
              Cross-reference your creative against the platforms you plan to
              advertise on. Each platform can have different rules and
              different points of failure.
            </p>

            <div className="mt-7 flex flex-wrap gap-2">
              {["Meta", "TikTok", "YouTube", "Pinterest", "X"].map(
                (platform) => (
                  <span
                    key={platform}
                    className="rounded-md border border-border bg-background px-2.5 py-1.5 text-xs font-medium text-muted-foreground"
                  >
                    {platform}
                  </span>
                )
              )}
            </div>
          </div>

          <div className="lg:col-span-7">
            <PolicyEngineVisual />
          </div>
        </div>

        {/* Feature 2 */}
        <div className="mt-24 grid items-center gap-10 lg:grid-cols-12 lg:gap-16">
          <div className="order-2 lg:order-1 lg:col-span-7">
            <FixVisual />
          </div>

          <div className="order-1 lg:order-2 lg:col-span-5">
            <p className="font-mono text-xs text-primary">02</p>

            <h3 className="mt-3 font-[family-name:var(--font-display)] text-3xl font-bold tracking-tight text-foreground">
              Don't just find the problem.
              <br />
              Know what to review.
            </h3>

            <p className="mt-5 text-base leading-relaxed text-muted-foreground">
              Results point you toward the part of the creative that needs
              attention, including timestamps and suggested changes where
              applicable.
            </p>

            <div className="mt-7 flex items-start gap-3 rounded-xl border border-border bg-background p-4">
              <Lock className="mt-0.5 h-4 w-4 shrink-0 text-primary" />

              <div>
                <p className="text-sm font-semibold text-foreground">
                  Privacy-first processing
                </p>

                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  Your creative is temporarily processed for analysis rather
                  than becoming a permanent asset in your account.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Small supporting statement */}
        <div className="mt-24 border-t border-border pt-8">
          <div className="grid gap-8 sm:grid-cols-3">
            <div>
              <p className="font-mono text-xs text-primary">SCAN DEPTH</p>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                Basic and Deep scanning for different editing styles.
              </p>
            </div>

            <div>
              <p className="font-mono text-xs text-primary">RISK LEVEL</p>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                Low, Medium, and High risk assessments make the result easier
                to act on.
              </p>
            </div>

            <div>
              <p className="font-mono text-xs text-primary">TIMESTAMPS</p>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                Jump directly to areas of the video that require attention.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
