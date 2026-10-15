//app/promotion/page.tsx
// Paid-traffic landing page: mediacrater.com/promotion
//
// Copy rules (keep these when editing):
// - Every claim must stay true. No approval guarantees, no "ban-proof".
// - Don't imply the bans in the screenshots were caused by creatives that
//   Mediacrater would have caught. One says "unusual activity", which is an
//   account-level flag, not a creative issue. This also applies to the page
//   title and the "Why I built Mediacrater" section.
// - Free plan = 3 regular scans/month. Audio analysis, deep scans and scan
//   history are paid (components/pricing.tsx). Keep those in sync.
// - The hero must say what the product does without scrolling.
//
// Layout rules for paid traffic:
// - No site navigation. One goal on the page: create an account.
// - noindex: this page is for ad traffic only. Don't add it to app/sitemap.ts.
// - The ids "hero-cta" and "final-cta" are read by StickyCta (mobile). Keep them.
import type { Metadata } from "next"
import Image from "next/image"
import Link from "next/link"
import { SignupCta } from "@/components/promotion/signup-cta"
import { DemoVideo } from "@/components/promotion/demo-video"
import { StickyCta } from "@/components/promotion/sticky-cta"

export const metadata: Metadata = {
  title: "I lost five ad accounts without knowing why. So I built Mediacrater.",
  description:
    "A former media buyer's tool for checking video and image ads for likely Meta, TikTok, YouTube, X and Pinterest policy issues before you upload.",
  robots: { index: false, follow: true },
}

const PLATFORMS = ["Meta", "TikTok", "YouTube", "X", "Pinterest"]

type ShotData = {
  src: string
  alt: string
  width: number
  height: number
  caption: string
}

// Real screenshot of the results page (timeline markers + evidence frames).
// Put the file in /public/images/ and fill this in to show it under the demo,
// e.g. { src: "/images/results-screenshot.png", alt: "...", width: 1900,
// height: 1100, caption: "..." }. While it is null, nothing renders.
const RESULTS_SHOT = null as ShotData | null

const STEPS = [
  {
    title: "Add your creative",
    body: "Upload a video or image, or paste a link to one.",
  },
  {
    title: "Choose where it will run",
    body: `Pick the platforms you plan to advertise on: ${PLATFORMS.join(", ")}.`,
  },
  {
    title: "Fix what's flagged",
    body: "See each likely issue, where it happens in the video, how serious it is, and a suggested fix.",
  },
]

const FAQS = [
  {
    q: "Is it really free?",
    a: "Yes. The free plan includes 3 scans a month and doesn't ask for a card. Paid plans start at $10 a month for 20 scans and add deep scans, audio analysis and scan history.",
  },
  {
    q: "Can it guarantee my ads get approved?",
    a: "No. Mediacrater points out likely policy issues in your creative. Each platform's own review makes the final decision.",
  },
  {
    q: "What happens to the files I upload?",
    a: "Your file is sent to our servers to be analysed. The privacy policy explains exactly what we keep and for how long.",
    link: { href: "/privacy", label: "Read the privacy policy" },
  },
  {
    q: "Is Mediacrater affiliated with Meta, TikTok or Google?",
    a: "No. Mediacrater is independent and isn't endorsed or sponsored by any ad platform.",
  },
]

function Shot({
  src,
  alt,
  width,
  height,
  caption,
  priority = false,
  sizes = "(min-width: 1024px) 50vw, 100vw",
}: ShotData & {
  priority?: boolean
  sizes?: string
}) {
  return (
    <figure>
      {/* Screenshots are light-mode Meta UI: keep a white frame in dark mode too. */}
      <div className="overflow-hidden rounded-xl border border-border bg-white shadow-xl shadow-foreground/5">
        {/* next/image serves resized WebP/AVIF instead of the full-size PNG. */}
        <Image
          src={src}
          alt={alt}
          width={width}
          height={height}
          sizes={sizes}
          priority={priority}
          className="h-auto w-full"
        />
      </div>
      <figcaption className="mt-3 text-sm leading-relaxed text-muted-foreground">{caption}</figcaption>
    </figure>
  )
}

export default function PromotionPage() {
  const year = new Date().getFullYear()

  return (
    <div className="min-h-screen overflow-x-hidden bg-background text-foreground">
      {/* Minimal header: logo + sign in only, so ad traffic isn't pulled away. */}
      <header className="border-b border-border" >
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <span className="flex items-center gap-2">
            <img src="/images/header-logo.png" alt="" width={36} height={36} className="h-9 w-9 dark:hidden" />
            <img src="/images/header-logo-dark.png" alt="" width={36} height={36} className="hidden h-9 w-9 dark:block" />
            <span className="font-[family-name:var(--font-display)] text-lg font-bold">Mediacrater</span>
          </span>
          <Link
            href="/signin"
            className="rounded-md text-sm font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Sign in
          </Link>
        </div>
      </header>

      <main>
        {/* Hero: the founder's own Business Manager is the headline image. */}
        <section className="border-b border-border pb-20 pt-14 md:pb-28 md:pt-20">
          <div className="mx-auto grid max-w-6xl items-center gap-12 px-4 sm:px-6 lg:grid-cols-12 lg:gap-10 lg:px-8">
            <div className="lg:col-span-6">
              <h1 className="font-[family-name:var(--font-display)] text-4xl font-bold leading-[1.05] tracking-[-0.03em] text-balance sm:text-5xl">
                Five ad accounts. All disabled. No clear reason why.
              </h1>
              {/* Says what the product is, above the fold. */}
              <p className="mt-6 max-w-xl text-xl font-medium leading-snug text-foreground text-pretty">
                Mediacrater checks your video and image ads against {PLATFORMS.slice(0, -1).join(", ")} and{" "}
                {PLATFORMS[PLATFORMS.length - 1]} ad policies before you upload, and shows you what&apos;s likely to
                get flagged.
              </p>
              <p className="mt-4 max-w-xl text-lg leading-relaxed text-muted-foreground text-pretty">
                I&apos;m Edward. Before I built it, I was a dropshipper and media buyer, and that&apos;s my Business
                Manager. Every ban stopped my campaigns, and none of them told me what I&apos;d done wrong.
              </p>
              <div className="mt-8">
                <div id="hero-cta">
                  <SignupCta position="hero" />
                </div>
                <p className="mt-3 text-sm text-muted-foreground">
                  3 free scans a month. No credit card. Sign up with email or Google.
                </p>
                <a
                  href="#demo"
                  className="mt-5 inline-block rounded-md text-sm font-medium text-primary underline underline-offset-4 hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  Or watch the 2-minute demo first
                </a>
              </div>
            </div>

            <div className="lg:col-span-6">
              <Shot
                src="/restriction_images/bulk-restriction-redacted.png"
                alt="Meta Business Manager list of five ad accounts, each with the status Disabled"
                width={1900}
                height={1082}
                caption="My own ad accounts in Meta Business Manager. Account IDs blurred."
                priority
              />
            </div>
          </div>
        </section>

        {/* How it works: product first, right after the hero. Demo, then the steps (a real sequence, so it's numbered). */}
        <section id="demo" className="scroll-mt-6 border-b border-border py-20 md:py-28">
          <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
            <h2 className="max-w-2xl font-[family-name:var(--font-display)] text-3xl font-bold tracking-[-0.03em] text-balance sm:text-4xl">
              Check the creative before you put budget behind it
            </h2>
            <div className="mt-10 max-w-4xl">
              <DemoVideo />
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                The demo also shows paid features: batch scans, deep analysis and scan history. The free plan covers
                single scans.
              </p>
            </div>
            {RESULTS_SHOT && (
              <div className="mt-12 max-w-4xl">
                <Shot {...RESULTS_SHOT} sizes="(min-width: 896px) 896px, 100vw" />
              </div>
            )}
            <ol className="mt-12 grid gap-10 md:grid-cols-3 md:gap-8">
              {STEPS.map((step, i) => (
                <li key={step.title} className="border-t-2 border-primary pt-5">
                  <p className="font-[family-name:var(--font-display)] text-sm font-bold text-primary">Step {i + 1}</p>
                  <h3 className="mt-2 text-xl font-bold">{step.title}</h3>
                  <p className="mt-2 leading-relaxed text-muted-foreground">{step.body}</p>
                </li>
              ))}
            </ol>
            <div className="mt-12">
              <SignupCta position="mid" label="Scan your first ad free" />
            </div>
          </div>
        </section>

        {/* The headache */}
        <section className="border-b border-border py-20 md:py-28">
          <div className="mx-auto grid max-w-6xl gap-14 px-4 sm:px-6 lg:grid-cols-2 lg:px-8">
            <div className="max-w-xl">
              <h2 className="font-[family-name:var(--font-display)] text-3xl font-bold tracking-[-0.03em] text-balance sm:text-4xl">
                A ban is rarely just one bad day
              </h2>
              <div className="mt-8 space-y-6 text-lg leading-relaxed text-muted-foreground">
                <p>
                  <strong className="font-semibold text-foreground">Spend stops mid-campaign.</strong> Whatever was
                  working stops getting traffic until the account is reviewed, if it comes back at all.
                </p>
                <p>
                  <strong className="font-semibold text-foreground">The explanation is vague.</strong> You get a line
                  like &ldquo;unusual activity&rdquo; and a Learn more link. You&apos;re left guessing which frame,
                  word or claim caused it.
                </p>
                <p>
                  <strong className="font-semibold text-foreground">It stays on your record.</strong> Rejections and
                  restrictions add up in your account history, and one careless upload can undo months of building it.
                </p>
              </div>
            </div>

            <div className="space-y-10">
              <Shot
                src="/restriction_images/restriction-2.png"
                alt="Meta notification: Ad account disabled. We noticed some unusual activity, so we've disabled your ad account."
                width={1616}
                height={612}
                caption="The notice on one of my accounts. That was the whole explanation."
              />
              <Shot
                src="/restriction_images/restriction-1-redacted.png"
                alt="Meta Ads Manager showing an account error: we can't calculate a score when your account is restricted."
                width={1368}
                height={918}
                caption="Even Meta's own Opportunity score goes blank once an account is restricted."
              />
            </div>
          </div>
        </section>

        {/* Why I built it */}
        <section className="border-b border-border bg-secondary/40 py-20 md:py-28">
          <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8">
            <h2 className="font-[family-name:var(--font-display)] text-3xl font-bold tracking-[-0.03em] sm:text-4xl">
              Why I built Mediacrater
            </h2>
            <div className="mt-8 space-y-6 text-lg leading-relaxed text-muted-foreground">
              <p>
                I lost five ad accounts and the money I&apos;d put into them, and I never got a clear answer about
                why. Some of those bans may have had nothing to do with my creatives. But creative mistakes were a
                risk I could control, and I had no way to check for them before publishing.
              </p>
              <p>
                What I wanted was simple. Before I hit publish, something that checks my creative against the
                platforms&apos; published ad policies, tells me what&apos;s likely to get flagged and why, and lets me
                fix it while it&apos;s still cheap to fix.
              </p>
              <p>
                I couldn&apos;t find that at a price a solo media buyer could justify. So I built it.
              </p>
            </div>
            <p className="mt-8 font-[family-name:var(--font-display)] text-lg font-semibold">Edward, founder</p>
          </div>
        </section>

        {/* Honest scope: builds trust with experienced media buyers. */}
        <section className="border-b border-border py-20 md:py-28">
          <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
            <h2 className="max-w-2xl font-[family-name:var(--font-display)] text-3xl font-bold tracking-[-0.03em] text-balance sm:text-4xl">
              Where Mediacrater helps, and where it can&apos;t
            </h2>
            <p className="mt-5 max-w-2xl text-lg leading-relaxed text-muted-foreground">
              Not every ban comes from a creative. Some of mine probably didn&apos;t. You should know where this tool
              stops before you rely on it.
            </p>
            <div className="mt-10 grid gap-6 md:grid-cols-2">
              <div className="rounded-2xl border border-primary/30 bg-primary/5 p-6 md:p-8">
                <h3 className="text-lg font-bold">It checks your creative</h3>
                <p className="mt-3 leading-relaxed text-muted-foreground">
                  On-screen text, visuals and claims in your videos and images, with timestamps and suggested fixes.
                  Paid plans also check spoken audio.
                </p>
              </div>
              <div className="rounded-2xl border border-border p-6 md:p-8">
                <h3 className="text-lg font-bold">It can&apos;t fix account-level problems</h3>
                <p className="mt-3 leading-relaxed text-muted-foreground">
                  Billing, identity verification, security or &ldquo;unusual activity&rdquo; flags, landing pages and
                  past account history are outside what it checks. It also can&apos;t guarantee approval.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Objections */}
        <section className="border-b border-border py-20 md:py-28">
          <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8">
            <h2 className="font-[family-name:var(--font-display)] text-3xl font-bold tracking-[-0.03em] sm:text-4xl">
              Before you sign up
            </h2>
            <div className="mt-10 divide-y divide-border border-y border-border">
              {FAQS.map((item) => (
                <details key={item.q} className="group py-5">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 rounded-md text-lg font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
                    {item.q}
                    <span
                      aria-hidden="true"
                      className="text-2xl font-normal leading-none text-muted-foreground transition-transform group-open:rotate-45 motion-reduce:transition-none"
                    >
                      +
                    </span>
                  </summary>
                  <p className="mt-3 leading-relaxed text-muted-foreground">
                    {item.a}
                    {item.link && (
                      <>
                        {" "}
                        <Link href={item.link.href} className="font-medium text-primary underline underline-offset-4">
                          {item.link.label}
                        </Link>
                        .
                      </>
                    )}
                  </p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* Final CTA */}
        <section className="py-20 md:py-28">
          <div className="mx-auto max-w-3xl px-4 text-center sm:px-6 lg:px-8">
            <h2 className="font-[family-name:var(--font-display)] text-3xl font-bold tracking-[-0.03em] text-balance sm:text-5xl">
              Check your next ad before you spend on it
            </h2>
            <p className="mx-auto mt-5 max-w-xl text-lg leading-relaxed text-muted-foreground">
              One upload shows you what&apos;s likely to get flagged, and why.
            </p>
            <div className="mt-8">
              <div id="final-cta">
                <SignupCta position="final" />
              </div>
              <p className="mt-3 text-sm text-muted-foreground">3 free scans a month. No credit card.</p>
            </div>
          </div>
        </section>
      </main>

      {/* Minimal footer: legal links ad platforms expect, no other exits. Extra bottom padding on mobile so the sticky CTA never covers it. */}
      <footer className="border-t border-border pb-28 pt-10 md:pb-10">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
          <nav aria-label="Legal" className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted-foreground">
            <Link href="/privacy" className="hover:text-foreground">Privacy policy</Link>
            <Link href="/terms" className="hover:text-foreground">Terms of service</Link>
            <Link href="/refund" className="hover:text-foreground">Refund policy</Link>
            <Link href="/cookies" className="hover:text-foreground">Cookie policy</Link>
          </nav>
          <p className="mt-6 max-w-4xl text-xs leading-relaxed text-muted-foreground">
            Mediacrater does not guarantee that any ad will be approved or that any account will avoid restrictions.
            Mediacrater is not affiliated with, endorsed by, or sponsored by Meta, TikTok, Google, YouTube, Pinterest
            or X. Screenshots show the founder&apos;s own ad accounts.
          </p>
          <p className="mt-4 text-xs text-muted-foreground">© {year} Mediacrater. All rights reserved.</p>
        </div>
      </footer>

      {/* Mobile only: appears once the hero CTA scrolls away, hides again at the final CTA. */}
      <StickyCta />
    </div>
  )
}
