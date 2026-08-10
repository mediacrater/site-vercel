"use client"

import { useState, useEffect } from "react"
import { Play, CheckCircle2 } from "lucide-react"

const YOUTUBE_VIDEO_ID = "Jk_XtsN1N9I"

const steps = [
  {
    step: "01",
    title: "Install Extension",
    description: "Add the Mediacrater Chrome extension in one click and verify your account.",
  },
  {
    step: "02",
    title: "Upload & Select Platforms",
    description: "Drag in your video creative and select whether you are targeting Meta, TikTok, or YouTube.",
  },
  {
    step: "03",
    title: "Configure Scan Depth",
    description: "Choose Basic for regular ads or Deep Scan for fast-paced edits with rapid cuts.",
  },
  {
    step: "04",
    title: "Get Instant Risk Breakdown",
    description: "Review detected risk zones, jump to violation timestamps, and copy suggested fixes.",
  },
]

export function HowItWorks() {
  const [activeStep, setActiveStep] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)

  // Auto-cycle through steps without causing layout shifts
  useEffect(() => {
    if (isPlaying) return

    const timer = setInterval(() => {
      setActiveStep((prev) => (prev + 1) % steps.length)
    }, 3500)

    return () => clearInterval(timer)
  }, [isPlaying])

  return (
    <section id="how-it-works" className="py-20 md:py-28 border-b border-border/50 bg-secondary/20 overflow-hidden">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        
        {/* Section Header */}
        <div className="max-w-3xl mb-14 text-left">
          <p className="text-xs font-bold uppercase tracking-widest text-primary mb-2">60-Second Workflow</p>
          <h2 className="text-3xl sm:text-4xl font-bold text-foreground font-[family-name:var(--font-display)]">
            How Mediacrater Works
          </h2>
          <p className="mt-3 text-lg text-muted-foreground">
            From installation to your first policy risk report in under a minute.
          </p>
        </div>

        {/* Split Section: Interactive Steps Left + YouTube Facade Right */}
        <div className="grid lg:grid-cols-12 gap-10 items-center">
          
          {/* Left Column: Step List with Fixed Heights */}
          <div className="lg:col-span-5 space-y-3">
            {steps.map((item, idx) => {
              const isActive = activeStep === idx
              return (
                <div
                  key={item.step}
                  onClick={() => setActiveStep(idx)}
                  className={`p-4 rounded-xl border transition-all duration-300 cursor-pointer ${
                    isActive 
                      ? "bg-card border-primary/50 shadow-sm ring-1 ring-inset ring-primary/20" 
                      : "bg-card/50 border-border/60 hover:bg-card hover:border-border"
                  }`}
                >
                  <div className="flex items-start gap-3">
                    <span className={`text-sm font-mono font-bold px-2 py-0.5 rounded transition-colors duration-300 shrink-0 ${
                      isActive ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                    }`}>
                      {item.step}
                    </span>
                    <div>
                      <h3 className="text-base font-bold text-foreground mb-1">
                        {item.title}
                      </h3>
                      <p className="text-xs text-muted-foreground leading-relaxed">
                        {item.description}
                      </p>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>

          {/* Right Column: YouTube Click-to-Play Mockup Frame */}
          <div className="lg:col-span-7">
            <div className="rounded-2xl border border-border bg-card shadow-xl overflow-hidden relative">
              {/* Window Bar */}
              <div className="px-4 py-2.5 bg-muted/60 border-b border-border flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <div className="w-2.5 h-2.5 rounded-full bg-red-500/70" />
                  <div className="w-2.5 h-2.5 rounded-full bg-amber-500/70" />
                  <div className="w-2.5 h-2.5 rounded-full bg-emerald-500/70" />
                </div>
                <div className="text-[11px] font-mono text-muted-foreground flex items-center gap-1">
                  mediacrater_walkthrough.mp4
                </div>
                <div className="w-12" />
              </div>

              {/* Player Container */}
              <div className="relative aspect-video bg-black overflow-hidden">
                {isPlaying ? (
                  <iframe
                    src={`https://www.youtube-nocookie.com/embed/${YOUTUBE_VIDEO_ID}?autoplay=1&rel=0`}
                    title="Mediacrater Product Walkthrough"
                    className="w-full h-full border-0"
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                  />
                ) : (
                  <div 
                    onClick={() => setIsPlaying(true)}
                    className="relative w-full h-full cursor-pointer group overflow-hidden"
                  >
                    {/* Reliable YouTube Thumbnail */}
                    <img
                      src={`https://img.youtube.com/vi/${YOUTUBE_VIDEO_ID}/hqdefault.jpg`}
                      alt="Mediacrater Video Walkthrough Thumbnail"
                      className="absolute inset-0 w-full h-full object-cover transition-transform duration-500 group-hover:scale-105 opacity-80"
                    />

                    {/* Dark Overlay Tint & Centered Play Badge */}
                    <div className="absolute inset-0 bg-black/40 group-hover:bg-black/30 transition-colors flex items-center justify-center p-4">
                      <div className="flex items-center gap-3 px-5 py-3 rounded-full bg-primary text-primary-foreground font-semibold shadow-2xl group-hover:scale-105 transition-transform z-10">
                        <div className="w-8 h-8 rounded-full bg-primary-foreground/20 flex items-center justify-center shrink-0">
                          <Play className="w-4 h-4 fill-primary-foreground text-primary-foreground ml-0.5" />
                        </div>
                        <span className="text-sm whitespace-nowrap">Watch Demo</span>
                      </div>
                    </div>

                    {/* Bottom Status Badge */}
                    <div className="absolute bottom-3 right-3 z-10 px-3 py-1 rounded-full bg-background/80 backdrop-blur-md border border-border text-[10px] font-mono text-muted-foreground flex items-center gap-1.5">
                      <CheckCircle2 className="w-3 h-3 text-emerald-500" /> YouTube HD Walkthrough
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

        </div>

      </div>
    </section>
  )
}
