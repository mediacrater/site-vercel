"use client"

import { AlertTriangle, CheckCircle2, Clock3, FileText, Layers3, Lock } from "lucide-react"

export function Features() {
  return (
    <section id="features" className="border-b border-border py-24 md:py-32">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="max-w-3xl">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-primary">Creative-level compliance intelligence</p>
          <h2 className="mt-4 font-[family-name:var(--font-display)] text-4xl font-bold tracking-[-0.035em] sm:text-5xl">Your ad is more than a video.</h2>
          <p className="mt-5 text-lg leading-relaxed text-muted-foreground">Mediacrater examines the creative itself—visuals, language, audio, claims, and platform requirements—to surface potential policy risks before submission.</p>
        </div>

        <div className="mt-16 border border-border bg-card">
          <div className="grid lg:grid-cols-[1.15fr_.85fr]">
            <div className="relative min-h-[440px] overflow-hidden bg-black">
              <div className="absolute inset-0 bg-gradient-to-br from-slate-700 via-slate-950 to-black" />
              <div className="absolute left-7 top-7 font-mono text-[10px] uppercase tracking-widest text-white/45">creative / frame 012</div>
              <div className="absolute left-[16%] top-[31%] border border-primary/70 bg-black/40 px-4 py-3 text-white backdrop-blur-sm"><p className="text-[9px] uppercase tracking-[.18em] text-white/45">On-screen claim</p><p className="mt-1 font-semibold">Guaranteed results</p></div>
              <div className="absolute left-7 right-7 bottom-8"><div className="flex justify-between font-mono text-[9px] text-white/40"><span>00:00</span><span>00:12 / 00:31</span></div><div className="mt-2 h-px bg-white/20"><div className="h-0.5 w-[39%] bg-primary" /></div></div>
            </div>
            <div className="divide-y divide-border">
              <div className="p-7"><div className="flex items-center gap-3"><AlertTriangle className="h-4 w-4 text-amber-500" /><span className="text-xs font-bold uppercase tracking-[.16em]">Detected issue</span></div><h3 className="mt-4 text-xl font-bold">Soft guarantee claim</h3><p className="mt-2 text-sm leading-relaxed text-muted-foreground">A specific point in the creative may create policy risk. The finding is anchored to the exact timestamp so your team can review it quickly.</p></div>
              <div className="grid grid-cols-2 divide-x divide-border"><div className="p-7"><Clock3 className="h-4 w-4 text-primary" /><p className="mt-3 text-xs text-muted-foreground">Timestamp</p><p className="mt-1 font-mono font-semibold">00:12</p></div><div className="p-7"><CheckCircle2 className="h-4 w-4 text-primary" /><p className="mt-3 text-xs text-muted-foreground">Confidence</p><p className="mt-1 font-mono font-semibold">78%</p></div></div>
              <div className="p-7"><p className="text-xs font-bold uppercase tracking-[.16em] text-muted-foreground">Recommended revision</p><p className="mt-3 text-sm leading-relaxed">Reframe the claim so the outcome is not presented as guaranteed.</p></div>
            </div>
          </div>
        </div>

        <div className="mt-6 grid gap-px overflow-hidden border border-border bg-border md:grid-cols-3">
          {[{icon:Layers3,title:"Platform-specific analysis",text:"Compare creative risk against the policies that matter to each advertising platform."},{icon:FileText,title:"Timestamped findings",text:"Go straight to the moment that needs attention instead of reviewing an entire ad manually."},{icon:Lock,title:"Privacy-first processing",text:"Your creative is analyzed with privacy in mind, because ad assets are valuable business data."}].map(({icon:Icon,title,text})=><div key={title} className="bg-background p-7"><Icon className="h-5 w-5 text-primary"/><h3 className="mt-5 font-semibold">{title}</h3><p className="mt-2 text-sm leading-relaxed text-muted-foreground">{text}</p></div>)}
        </div>
        <div className="mt-8 text-center">
          <a
            href="https://mediacrater.com/solutions"
            className="text-sm font-medium text-primary underline-offset-4 hover:underline"
          >
            Looking for a custom or high-volume solution? →
          </a>
        </div>
      </div>
    </section>
  )
}
