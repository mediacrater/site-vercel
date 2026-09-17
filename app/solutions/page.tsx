"use client"

import { useEffect, useRef, useState } from "react"
import Script from "next/script"
import {
  Building2,
  Code2,
  Layers3,
  MessageSquare,
  ShieldCheck,
  Zap,
} from "lucide-react"

declare global {
  interface Window {
    turnstile?: {
      render: (
        container: string | HTMLElement,
        options: {
          sitekey: string
          callback: (token: string) => void
          "expired-callback"?: () => void
          "error-callback"?: () => void
        }
      ) => string
      reset: (widgetId?: string) => void
    }
  }
}

export default function SolutionsPage() {
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    company: "",
    volume: "",
    message: "",
  })
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle")
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null)
  const [turnstileScriptLoaded, setTurnstileScriptLoaded] = useState(false)
  const turnstileContainerRef = useRef<HTMLDivElement>(null)
  const turnstileWidgetIdRef = useRef<string | null>(null)

  useEffect(() => {
    if (!turnstileScriptLoaded) return
    if (!turnstileContainerRef.current) return
    if (!window.turnstile) return
    if (turnstileWidgetIdRef.current) return // already rendered once

    const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY
    if (!siteKey) {
      console.error("NEXT_PUBLIC_TURNSTILE_SITE_KEY is not set.")
      return
    }

    turnstileWidgetIdRef.current = window.turnstile.render(turnstileContainerRef.current, {
      sitekey: siteKey,
      callback: (token: string) => setTurnstileToken(token),
      "expired-callback": () => setTurnstileToken(null),
      "error-callback": () => setTurnstileToken(null),
    })
  }, [turnstileScriptLoaded])

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) => {
    setFormData((prev) => ({ ...prev, [e.target.name]: e.target.value }))
  }

  const resetTurnstile = () => {
    setTurnstileToken(null)
    if (window.turnstile && turnstileWidgetIdRef.current) {
      window.turnstile.reset(turnstileWidgetIdRef.current)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!turnstileToken) {
      setErrorMessage("Please complete the verification checkbox.")
      setStatus("error")
      return
    }

    setStatus("loading")
    setErrorMessage(null)

    try {
      const response = await fetch("/api/custom-solutions-form", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...formData, turnstileToken }),
      })

      if (!response.ok) {
        const data = await response.json().catch(() => null)
        setErrorMessage(
          data?.error ?? "Something went wrong. Please try again."
        )
        setStatus("error")
        resetTurnstile() // token is single-use; force a fresh one on retry
        return
      }

      setStatus("success")
      setFormData({ name: "", email: "", company: "", volume: "", message: "" })
      resetTurnstile()
    } catch {
      setErrorMessage("Something went wrong. Please try again.")
      setStatus("error")
      resetTurnstile()
    }
  }

  return (
    <main className="border-b border-border">
      <Script
        src="https://challenges.cloudflare.com/turnstile/v0/api.js"
        strategy="afterInteractive"
        onLoad={() => setTurnstileScriptLoaded(true)}
      />
      {/* Hero */}
      <section className="py-24 md:py-32">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="max-w-3xl">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-primary">
              Custom Solutions
            </p>
            <h1 className="mt-4 font-[family-name:var(--font-display)] text-4xl font-bold tracking-[-0.035em] sm:text-5xl">
              Built for platforms, agencies, and high-volume teams.
            </h1>
            <p className="mt-5 text-lg leading-relaxed text-muted-foreground">
              Mediacrater’s core analysis engine can be adapted for deeper integrations,
              higher throughput, and custom workflows — including API access and
              specialized processing pipelines.
            </p>
          </div>
        </div>
      </section>

      {/* What we offer */}
      <section className="border-t border-border py-20">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="max-w-2xl">
            <h2 className="font-[family-name:var(--font-display)] text-3xl font-bold tracking-[-0.03em]">
              What custom solutions include
            </h2>
            <p className="mt-3 text-muted-foreground">
              Flexible options designed around how your team or platform actually works.
            </p>
          </div>

          <div className="mt-12 grid gap-px overflow-hidden border border-border bg-border md:grid-cols-2 lg:grid-cols-3">
            {[
              {
                icon: Code2,
                title: "API Access",
                text: "Integrate Mediacrater’s analysis directly into your existing tools, dashboards, or review workflows.",
              },
              {
                icon: Zap,
                title: "Higher Volume & Priority",
                text: "Dedicated capacity and faster processing for teams running large numbers of creatives.",
              },
              {
                icon: Layers3,
                title: "Custom Analysis Pipelines",
                text: "Tailored handling of video frames, audio extraction, and platform-specific rules.",
              },
              {
                icon: ShieldCheck,
                title: "Enhanced Compliance Rules",
                text: "Additional checks or internal policy layers on top of standard platform guidelines.",
              },
              {
                icon: Building2,
                title: "Platform / White-label Options",
                text: "Backend or embedded solutions for platforms that want to offer compliance tools to their users.",
              },
              {
                icon: MessageSquare,
                title: "Dedicated Support",
                text: "Direct communication channel for onboarding, iteration, and ongoing optimization.",
              },
            ].map(({ icon: Icon, title, text }) => (
              <div key={title} className="bg-background p-7">
                <Icon className="h-5 w-5 text-primary" />
                <h3 className="mt-5 font-semibold">{title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {text}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Who it's for */}
      <section className="border-t border-border bg-card/40 py-20">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="max-w-2xl">
            <h2 className="font-[family-name:var(--font-display)] text-3xl font-bold tracking-[-0.03em]">
              Who this is for
            </h2>
          </div>

          <div className="mt-10 grid gap-6 md:grid-cols-3">
            {[
              {
                title: "Advertising Platforms",
                text: "Teams that want stronger pre-launch compliance checks for their advertisers.",
              },
              {
                title: "Agencies & Media Buyers",
                text: "Groups managing multiple accounts or high creative volume who need more than self-serve limits.",
              },
              {
                title: "Product & Growth Teams",
                text: "Companies looking to embed creative risk analysis into internal review or launch processes.",
              },
            ].map((item) => (
              <div
                key={item.title}
                className="border border-border bg-background p-7"
              >
                <h3 className="font-semibold">{item.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  {item.text}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Contact Form */}
      <section className="border-t border-border py-20 md:py-28">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="grid gap-12 lg:grid-cols-2">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-primary">
                Get in touch
              </p>
              <h2 className="mt-4 font-[family-name:var(--font-display)] text-3xl font-bold tracking-[-0.03em] sm:text-4xl">
                Tell us what you need
              </h2>
              <p className="mt-4 text-muted-foreground leading-relaxed">
                Share a bit about your use case and volume. We’ll follow up within
                1–2 business days to explore whether a custom setup makes sense.
              </p>
            </div>

            <div className="border border-border bg-card p-7 sm:p-8">
              {status === "success" ? (
                <div className="flex flex-col items-start gap-3 py-8">
                  <p className="text-lg font-semibold">Message received</p>
                  <p className="text-sm text-muted-foreground">
                    Thanks for reaching out. We’ll get back to you shortly.
                  </p>
                  <button
                    onClick={() => setStatus("idle")}
                    className="mt-4 text-sm font-medium text-primary hover:underline"
                  >
                    Send another message
                  </button>
                </div>
              ) : (
                <form onSubmit={handleSubmit} className="space-y-5">
                  <div className="grid gap-5 sm:grid-cols-2">
                    <div>
                      <label
                        htmlFor="name"
                        className="block text-xs font-medium text-muted-foreground"
                      >
                        Name
                      </label>
                      <input
                        id="name"
                        name="name"
                        required
                        value={formData.name}
                        onChange={handleChange}
                        className="mt-1.5 w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
                      />
                    </div>
                    <div>
                      <label
                        htmlFor="email"
                        className="block text-xs font-medium text-muted-foreground"
                      >
                        Work email
                      </label>
                      <input
                        id="email"
                        name="email"
                        type="email"
                        required
                        value={formData.email}
                        onChange={handleChange}
                        className="mt-1.5 w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
                      />
                    </div>
                  </div>

                  <div>
                    <label
                      htmlFor="company"
                      className="block text-xs font-medium text-muted-foreground"
                    >
                      Company / Platform
                    </label>
                    <input
                      id="company"
                      name="company"
                      required
                      value={formData.company}
                      onChange={handleChange}
                      className="mt-1.5 w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="volume"
                      className="block text-xs font-medium text-muted-foreground"
                    >
                      Approximate monthly volume
                    </label>
                    <select
                      id="volume"
                      name="volume"
                      required
                      value={formData.volume}
                      onChange={handleChange}
                      className="mt-1.5 w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
                    >
                      <option value="">Select a range</option>
                      <option value="under-100">Under 100 creatives</option>
                      <option value="100-500">100 – 500</option>
                      <option value="500-2000">500 – 2,000</option>
                      <option value="2000-plus">2,000+</option>
                      <option value="platform">Platform / very high volume</option>
                    </select>
                  </div>

                  <div>
                    <label
                      htmlFor="message"
                      className="block text-xs font-medium text-muted-foreground"
                    >
                      How can we help?
                    </label>
                    <textarea
                      id="message"
                      name="message"
                      rows={4}
                      value={formData.message}
                      onChange={handleChange}
                      className="mt-1.5 w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary resize-none"
                      placeholder="Tell us about your use case, integration needs, or timeline..."
                    />
                  </div>

                  {status === "error" && (
                    <p className="text-sm text-red-500">
                      {errorMessage ?? "Something went wrong. Please try again."}
                    </p>
                  )}

                  <div ref={turnstileContainerRef} />

                  <button
                    type="submit"
                    disabled={status === "loading" || !turnstileToken}
                    className="w-full rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
                  >
                    {status === "loading" ? "Sending..." : "Submit inquiry"}
                  </button>
                </form>
              )}
            </div>
          </div>
        </div>
      </section>
    </main>
  )
}
