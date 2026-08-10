import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Shield, CheckCircle, Zap, AlertTriangle, Check } from "lucide-react"

const EXTENSION_LINK = "https://chromewebstore.google.com/detail/mediacrater-ad-compliance/fgekklkpomdcadiaekpigidkimnkjpnf?utm_medium=website_hero"

export function Hero() {
  return (
    <section className="relative pt-28 pb-16 md:pt-36 md:pb-24 border-b border-border/50">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="grid lg:grid-cols-12 gap-12 lg:gap-8 items-center">
          
          {/* Left Column: Copy & Action */}
          <div className="lg:col-span-7 flex flex-col items-start text-left">
            <Badge variant="outline" className="mb-6 px-3.5 py-1.5 text-xs font-semibold rounded-full border-primary/30 bg-primary/5 text-primary">
              <Zap className="w-3.5 h-3.5 mr-1.5 text-primary fill-primary/20" />
              3 Free Tokens on Signup
            </Badge>

            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight text-foreground font-[family-name:var(--font-display)] leading-[1.15]">
              Video Ad <span className="text-primary">Policy Checker</span>
            </h1>
            
            <p className="mt-3 text-xl sm:text-2xl font-bold text-foreground/90 font-[family-name:var(--font-display)]">
              Never Get an Ad Rejection Notification Again
            </p>

            <p className="mt-5 text-base sm:text-lg text-muted-foreground max-w-xl leading-relaxed">
              Scan your video ads for Meta, TikTok, and Google policy violations before uploading.
              Get instant risk zone assessments and actionable fixes in 60 seconds.*
            </p>

            {/* CTAs */}
            <div className="mt-8 flex flex-col sm:flex-row gap-3 w-full sm:w-auto">
              <Button
                asChild
                size="lg"
                className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold text-base px-7 py-6 shadow-sm"
              >
                <a href={EXTENSION_LINK} target="_blank" rel="noopener noreferrer">
                  <Shield className="w-5 h-5 mr-2" />
                  Try for free
                </a>
              </Button>
              <Button
                asChild
                variant="outline"
                size="lg"
                className="text-base px-7 py-6 border-border hover:bg-secondary/80 bg-card text-foreground font-medium"
              >
                <a href="https://www.youtube.com/watch?v=Jk_XtsN1N9I?utm_medium=website_how-it-works">See How It Works</a>
              </Button>
            </div>

            {/* Trust Badges */}
            <div className="mt-8 pt-8 border-t border-border/60 w-full flex flex-wrap items-center gap-x-6 gap-y-3 text-xs sm:text-sm font-medium text-muted-foreground">
              <div className="flex items-center gap-2">
                <CheckCircle className="w-4 h-4 text-emerald-500" />
                <span>Privacy-first processing</span>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle className="w-4 h-4 text-emerald-500" />
                <span>Multi-platform support</span>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle className="w-4 h-4 text-emerald-500" />
                <span>As low as $0.19/scan</span>
              </div>
            </div>

            {/* Supported Platforms Strip */}
            <div className="mt-8 flex items-center gap-4">
              <span className="text-xs uppercase tracking-wider font-bold text-muted-foreground/70">Platforms:</span>
              <div className="flex items-center gap-3 text-muted-foreground">
                <span className="text-xs font-semibold px-2.5 py-1 rounded bg-secondary/80 border border-border">Meta</span>
                <span className="text-xs font-semibold px-2.5 py-1 rounded bg-secondary/80 border border-border">TikTok</span>
                <span className="text-xs font-semibold px-2.5 py-1 rounded bg-secondary/80 border border-border">YouTube</span>
                <span className="text-xs font-semibold px-2.5 py-1 rounded bg-secondary/80 border border-border">X</span>
                <span className="text-xs font-semibold px-2.5 py-1 rounded bg-secondary/80 border border-border">Pinterest</span>
              </div>
            </div>
          </div>

          {/* Right Column: Risk Zone Scan Mockup Visual */}
          <div className="lg:col-span-5 relative">
            <div className="rounded-2xl border border-border bg-card shadow-xl overflow-hidden">
              {/* Widget Header */}
              <div className="px-4 py-3 bg-muted/40 border-b border-border flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-destructive/60" />
                  <div className="w-3 h-3 rounded-full bg-amber-500/60" />
                  <div className="w-3 h-3 rounded-full bg-emerald-500/60" />
                  <span className="ml-2 text-xs font-mono text-muted-foreground">compliance_audit.mp4</span>
                </div>
                <Badge variant="secondary" className="text-[10px] font-mono bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20">
                  Scan Complete
                </Badge>
              </div>

              {/* Widget Body */}
              <div className="p-5 space-y-4">
                {/* Risk Level Banner */}
                <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-between">
                  <div>
                    <p className="text-[11px] uppercase tracking-wider font-bold text-amber-600 dark:text-amber-400">Policy Assessment</p>
                    <p className="text-xl font-extrabold text-foreground font-mono flex items-center gap-1.5 mt-0.5">
                      Medium Risk
                    </p>
                  </div>
                  {/* 3-Tier Indicator Bar */}
                  <div className="flex flex-col items-end gap-1">
                    <span className="text-[10px] text-muted-foreground font-mono">1 Issue Detected</span>
                    <div className="flex items-center gap-1">
                      <div className="w-6 h-2 rounded bg-emerald-500/30" />
                      <div className="w-6 h-2 rounded bg-amber-500" />
                      <div className="w-6 h-2 rounded bg-muted" />
                    </div>
                  </div>
                </div>

                {/* Detected Flags */}
                <div className="space-y-2.5">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Audit Log</p>
                  
                  <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-xs flex items-start gap-2.5">
                    <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                    <div>
                      <span className="font-semibold text-foreground">Timestamp 0:12 — Soft Guarantee Claim</span>
                      <p className="text-muted-foreground mt-0.5">1 medium-severity violation found. Change phrasing to pass Low Risk threshold.</p>
                    </div>
                  </div>

                  <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-xs flex items-start gap-2.5">
                    <Check className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                    <div>
                      <span className="font-semibold text-foreground">TikTok Safe Zone Guidelines</span>
                      <p className="text-muted-foreground mt-0.5">Text overlays clear all native UI elements.</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Widget Footer */}
              <div className="px-4 py-3 bg-muted/20 border-t border-border flex items-center justify-between text-xs text-muted-foreground">
                <span>Deep Scan Depth</span>
                <span className="font-mono text-primary font-medium">0.4s processing</span>
              </div>
            </div>
          </div>

        </div>
      </div>
    </section>
  )
}
