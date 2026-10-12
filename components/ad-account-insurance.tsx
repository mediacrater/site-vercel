const insurancePoints = [
  {
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
      </svg>
    ),
    title: 'Platforms never explain',
    body: "Meta, TikTok, and YouTube reject ads or ban accounts with zero details. You’re left guessing what went wrong. Mediacrater flags issues in advance before you upload.",
  },
  {
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 6l3 1m0 0l-3 9a5.002 5.002 0 006.001 0M6 7l3 9M6 7l6-2m6 2l3-1m-3 1l-3 9a5.002 5.002 0 006.001 0M18 7l3 9m-3-9l-6-2m0-2v2m0 16V5m0 16H9m3 0h3" />
      </svg>
    ),
    title: 'Whales get away with it',
    body: "Big brands survive violations that kill small accounts. Mediacrater levels the field by teaching you the real rules faster.",
  },
  {
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
      </svg>
    ),
    title: 'Every rejection and restriction stays on record. Catching problems before upload means fewer of them.',
    body: "Every compliant ad strengthens your account history. Faster approvals, better delivery, more leniency. One bad upload can undo months of progress.",
  },
]

const SIGNUP_URL = '/signup?src=home-insurance&utm_source=website&utm_medium=cta&utm_campaign=home-insurance'

export function AdAccountInsurance() {
  return (
    <section className="py-20 md:py-28 bg-background">
      <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8">

        {/* Eyebrow */}
        <div className="flex items-center justify-center gap-3 mb-6">
          <div className="h-px flex-1 max-w-[60px] bg-border" />
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Protect your business
          </p>
          <div className="h-px flex-1 max-w-[60px] bg-border" />
        </div>

        {/* Heading */}
        <div className="text-center max-w-3xl mx-auto mb-6">
          <h2 className="text-3xl sm:text-4xl font-bold text-foreground font-[family-name:var(--font-display)] text-balance leading-tight">
            Everyone hates insurance...{' '}
            <span className="text-accent">until something goes wrong.</span>
          </h2>
        </div>

        {/* Opening paragraph */}
        <p className="text-center text-lg text-muted-foreground max-w-2xl mx-auto mb-16 text-pretty leading-relaxed">
          Ad account bans hit without warning or explanation. One hidden violation and your campaigns go dark, revenue stops, and you’re rebuilding from scratch. Mediacrater shows you the risks before you upload.
        </p>

        {/* Three points */}
        <div className="grid sm:grid-cols-3 gap-6 mb-16">
          {insurancePoints.map((point) => (
            <div
              key={point.title}
              className="bg-card border border-border rounded-2xl p-6 flex flex-col gap-4"
            >
              <div className="w-10 h-10 rounded-xl bg-accent/10 text-accent flex items-center justify-center shrink-0">
                {point.icon}
              </div>
              <div>
                <h3 className="font-bold text-foreground mb-2 leading-snug">{point.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{point.body}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Closing CTA */}
        <div className="text-center">
          <p className="text-muted-foreground text-base mb-6 max-w-xl mx-auto text-pretty">
            This isn’t just about protecting one ad. It’s about building the account history that platforms reward. The kind most of your competitors don’t have.
          </p>
          <a
            href={SIGNUP_URL}
            className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-6 py-3 rounded-xl font-semibold text-sm hover:opacity-90 transition-opacity"
          >
            Try Mediacrater free
          </a>
          <p className="text-xs text-muted-foreground mt-3">No credit card required · 3 free scans every month</p>
        </div>

      </div>
    </section>
  )
}
