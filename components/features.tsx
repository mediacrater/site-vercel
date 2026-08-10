"use client"

import { Shield, Headphones, Zap, Lock, FileText, AlertTriangle, CheckCircle, ArrowRight, Notebook } from "lucide-react"
import { useState, useEffect } from "react"

function FixAnimationVisual() {
  const [step, setStep] = useState(0)

  useEffect(() => {
    const timer = setInterval(() => {
      setStep((prev) => (prev + 1) % 3)
    }, 2000)
    return () => clearInterval(timer)
  }, [])

  return (
    <div className="mt-5 p-3.5 rounded-xl bg-muted/60 border border-border">
      <div className="flex items-center gap-2 mb-2.5">
        <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md transition-all duration-500 ${
          step === 0 ? "bg-destructive/20 text-destructive border border-destructive/30" : "bg-card text-muted-foreground opacity-50"
        }`}>
          <AlertTriangle className="w-3.5 h-3.5" />
          <span className="text-[11px] font-bold">Violation</span>
        </div>
        
        <ArrowRight className="w-3.5 h-3.5 text-muted-foreground" />
        
        <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md transition-all duration-500 ${
          step === 2 ? "bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30" : "bg-card text-muted-foreground opacity-50"
        }`}>
          <CheckCircle className="w-3.5 h-3.5" />
          <span className="text-[11px] font-bold">Compliant</span>
        </div>
      </div>
      
      <div className="space-y-1.5 text-xs font-mono">
        <div className={`p-2 rounded transition-all duration-500 ${
          step === 0 ? "bg-destructive/10 text-destructive border-l-2 border-destructive" : "opacity-30 text-muted-foreground"
        }`}>
          "Lose 10lbs in 7 days!"
        </div>
        <div className={`p-2 rounded transition-all duration-500 ${
          step === 2 ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-l-2 border-emerald-500" : "opacity-30 text-muted-foreground"
        }`}>
          "Support your wellness journey"
        </div>
      </div>
    </div>
  )
}

export function Features() {
  return (
    <section id="features" className="py-20 md:py-28 bg-secondary/30 border-b border-border/50">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        
        {/* Section Header */}
        <div className="max-w-3xl mb-14 text-left">
          <p className="text-xs font-bold uppercase tracking-widest text-primary mb-2">Engineered for Accuracy</p>
          <h2 className="text-3xl sm:text-4xl font-bold text-foreground font-[family-name:var(--font-display)]">
            Built for Professional Media Buyers
          </h2>
          <p className="mt-3 text-lg text-muted-foreground">
            Pre-upload intelligence that transforms your ad workflow. Stop guessing, stop waiting, stop appealing.
          </p>
        </div>

        {/* Bento Grid */}
        <div className="grid md:grid-cols-3 gap-5">
          
          {/* Card 1: Large Span */}
          <div className="md:col-span-2 p-7 rounded-2xl bg-card border border-border hover:border-primary/40 transition-all flex flex-col justify-between">
            <div>
              <div className="w-10 h-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center mb-5">
                <Notebook className="w-5 h-5" />
              </div>
              <h3 className="text-xl font-bold text-foreground mb-2">Multi-Platform Policy Engine</h3>
              <p className="text-muted-foreground leading-relaxed">
                Cross-references your ad against platform-specific rulebooks for YouTube, Meta, TikTok, and more. What passes on Pinterest might be rejected on TikTok, Mediacrater knows the difference.
              </p>
            </div>
            <div className="mt-6 pt-4 border-t border-border/60 flex items-center gap-3 text-xs text-muted-foreground font-mono">
              <span className="px-2 py-1 rounded bg-secondary">Meta Ads Rules</span>
              <span className="px-2 py-1 rounded bg-secondary">TikTok Guidelines</span>
              <span className="px-2 py-1 rounded bg-secondary">Google Policy v2026</span>
            </div>
          </div>

          {/* Card 2: Interactive Fix Visual */}
          <div className="p-7 rounded-2xl bg-card border border-border hover:border-primary/40 transition-all">
            <div className="w-10 h-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center mb-5">
              <FileText className="w-5 h-5" />
            </div>
            <h3 className="text-xl font-bold text-foreground mb-2">Actionable Fixes</h3>
            <p className="text-muted-foreground text-sm leading-relaxed">
              We don't just find problems, we solve them. Get specific suggestions instantly.
            </p>
            <FixAnimationVisual />
          </div>

          {/* Card 3 */}
          <div className="p-7 rounded-2xl bg-card border border-border hover:border-primary/40 transition-all">
            <div className="w-10 h-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center mb-5">
              <Shield className="w-5 h-5" />
            </div>
            <h3 className="text-xl font-bold text-foreground mb-2">Visual Audit (2 Scan Depths)</h3>
            <p className="text-muted-foreground text-sm leading-relaxed">
              Choose from Basic for quicker verification with cuts lasting 1s+, or Deep for scrutiny on high-risk, fast-paced edits under 1 second.
            </p>
          </div>

          {/* Card 4: 3-Tier Risk Zone Assessment */}
          <div className="p-7 rounded-2xl bg-card border border-border hover:border-primary/40 transition-all">
            <div className="w-10 h-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center mb-5">
              <Zap className="w-5 h-5" />
            </div>
            <h3 className="text-xl font-bold text-foreground mb-2">3-Tier Risk Assessment</h3>
            <p className="text-muted-foreground text-sm leading-relaxed">
              Categorizes your ad into Low Risk (Clean), Medium Risk (Single issue), or High Risk (Multiple issues) so you know exactly what to fix before going live.
            </p>
          </div>

          {/* Card 5 */}
          <div className="p-7 rounded-2xl bg-card border border-border hover:border-primary/40 transition-all">
            <div className="w-10 h-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center mb-5">
              <Lock className="w-5 h-5" />
            </div>
            <h3 className="text-xl font-bold text-foreground mb-2">Scan-and-Forget Architecture</h3>
            <p className="text-muted-foreground text-sm leading-relaxed">
              Your creative assets are never stored on our servers. We scan your ad and permanently delete it the moment results are returned.
            </p>
          </div>

        </div>
      </div>
    </section>
  )
}
