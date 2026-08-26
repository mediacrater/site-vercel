'use client';

// components/auth-showcase-panel.tsx
//
// The non-form side of the split-screen sign-in/sign-up layout. Fixed
// dark navy background regardless of site theme (light/dark toggle) —
// a deliberate branded moment, same idea as a lot of the split-auth
// examples researched (Headspace, Squarespace, etc.) where one side
// stays on-brand color while the form side follows the user's theme.
//
// Reuses the same testimonial screenshots already live on the buy-tokens
// pricing page (public/images/testimonials/fb-comment-*.png) rather than
// sourcing new content.

const TESTIMONIALS = [
  {
    src: '/images/testimonials/fb-comment-1.png',
    name: 'Maham Khan',
    role: 'Facebook Ads Expert',
    quote: 'Thumbs up if this sounds useful. Thumbs down if not. Brutal honesty helps.',
  },
  {
    src: '/images/testimonials/fb-comment-2.png',
    name: 'Roy Mark Olino Conde',
    role: 'Media Buyer',
    quote: "The idea is great and I didn't see any software yet with this function.",
  },
  {
    src: '/images/testimonials/fb-comment-3.png',
    name: 'S Tania Akther',
    role: 'Ad Specialist',
    quote: 'A tool that checks creatives before uploading would save time and stress for marketers.',
  },
];

export function AuthShowcasePanel({ variant }: { variant: 'signin' | 'signup' }) {
  const heading =
    variant === 'signup'
      ? 'Stop guessing whether your ad will get banned.'
      : 'Welcome back.';

  const subheading =
    variant === 'signup'
      ? 'Scan your creative against Meta, TikTok, YouTube, Pinterest, and X policies before you spend a dollar on media.'
      : 'Your scans, history, and plan are exactly where you left them.';

  return (
    <div className="hidden lg:flex flex-col justify-between w-1/2 min-h-screen px-12 py-16 bg-gradient-to-br from-[#0d1b2a] to-[#1a2e44] text-white">
      <div>
        <a href="/" className="inline-flex items-center gap-2">
          <img src="/images/header-logo-dark.png" alt="Mediacrater" className="h-9 w-9" />
          <span className="text-lg font-bold">Mediacrater</span>
        </a>

        <h1 className="text-3xl font-bold mt-16 leading-tight max-w-md">{heading}</h1>
        <p className="text-white/60 mt-3 max-w-sm text-sm leading-relaxed">{subheading}</p>
      </div>

      {variant === 'signup' && (
        <div className="space-y-4">
          {TESTIMONIALS.map((t) => (
            <div key={t.name} className="flex items-start gap-3 bg-white/5 border border-white/10 rounded-xl p-4">
              <img src={t.src} alt="" className="w-10 h-10 rounded-full object-cover flex-shrink-0" />
              <div>
                <p className="text-sm text-white/80 italic leading-relaxed">&ldquo;{t.quote}&rdquo;</p>
                <p className="text-xs text-white/50 mt-1.5">
                  {t.name} · {t.role}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}

      {variant === 'signin' && (
        <div className="flex items-start gap-3 bg-white/5 border border-white/10 rounded-xl p-4 max-w-sm">
          <img src={TESTIMONIALS[0].src} alt="" className="w-10 h-10 rounded-full object-cover flex-shrink-0" />
          <div>
            <p className="text-sm text-white/80 italic leading-relaxed">&ldquo;{TESTIMONIALS[0].quote}&rdquo;</p>
            <p className="text-xs text-white/50 mt-1.5">
              {TESTIMONIALS[0].name} · {TESTIMONIALS[0].role}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
