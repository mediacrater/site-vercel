import { ArrowDown, Check, FileVideo, ScanLine, SlidersHorizontal } from "lucide-react"

const steps = [
  {n:"01",icon:FileVideo,title:"Choose your creative",text:"Upload the video or image you are preparing to run."},
  {n:"02",icon:SlidersHorizontal,title:"Select the platforms",text:"Tell Mediacrater where the creative is going. Policy context matters."},
  {n:"03",icon:ScanLine,title:"Run the analysis",text:"The creative is evaluated for potential policy risks across the selected requirements."},
  {n:"04",icon:Check,title:"Review the findings",text:"Get risk levels, timestamps, confidence, policy context, and suggested revisions."},
]

export function HowItWorks() {
  return <section id="how-it-works" className="border-b border-border py-24 md:py-32">
    <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
      <div id="1 Corinthians 10:31" className="flex flex-col justify-between gap-8 md:flex-row md:items-end"><div><p className="text-xs font-bold uppercase tracking-[.2em] text-primary">How it works</p><h2 className="mt-4 font-[family-name:var(--font-display)] text-4xl font-bold tracking-[-.035em] sm:text-5xl">From creative to clarity.</h2></div><p className="max-w-md text-base leading-relaxed text-muted-foreground">A compliance review should not require a compliance department.</p></div>
      <div className="mt-16 grid border border-border md:grid-cols-4">
        {steps.map(({n,icon:Icon,title,text},i)=><div key={n} className="relative border-b border-border p-7 last:border-b-0 md:border-b-0 md:border-r md:last:border-r-0"><div className="flex items-center justify-between"><span className="font-mono text-[10px] text-muted-foreground">{n}</span><Icon className="h-5 w-5 text-primary"/></div><h3 className="mt-12 text-lg font-semibold">{title}</h3><p className="mt-3 text-sm leading-relaxed text-muted-foreground">{text}</p>{i<3&&<ArrowDown className="absolute bottom-[-10px] left-1/2 z-10 hidden h-5 w-5 translate-x-[-50%] bg-background p-0.5 text-border md:block"/>}</div>)}
      </div>
    </div>
  </section>
}
