export function SocialProof() {
  const reviews = ["/images/testimonials/fb-comment-1.png","/images/testimonials/fb-comment-2.png","/images/testimonials/fb-comment-3.png"]
  return <section className="border-b border-border py-24 md:py-32">
    <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
      <div className="grid gap-12 lg:grid-cols-[.8fr_1.2fr] lg:items-center">
        <div><p className="text-xs font-bold uppercase tracking-[.2em] text-primary">Validated by media buyers</p><h2 className="mt-4 font-[family-name:var(--font-display)] text-4xl font-bold tracking-[-.035em] sm:text-5xl">The people buying the traffic know the problem.</h2><p className="mt-5 max-w-lg text-lg leading-relaxed text-muted-foreground">Policy issues are not theoretical when your campaigns are live. These are the conversations that led us to build a better way to review creative before submission.</p></div>
        <div className="grid gap-5 sm:grid-cols-3">{reviews.map((src,i)=><div key={src} className="overflow-hidden border border-border bg-card shadow-sm"><img src={src} alt={`Media buyer feedback ${i+1}`} className="h-auto w-full" /></div>)}</div>
      </div>
    </div>
  </section>
}
