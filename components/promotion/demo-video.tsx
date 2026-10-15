//components/promotion/demo-video.tsx
"use client"
// Click-to-play Vimeo demo for /promotion.
//
// Why a facade instead of the raw embed:
// - The demo has a voiceover. Muted autoplay + loop hides the narration.
// - The Vimeo player is heavy. Loading it only on click keeps the page fast
//   for paid traffic (most visitors decide in the first few seconds).
// - dnt=1 stops Vimeo from setting tracking cookies, which matters until a
//   cookie consent banner exists (Quebec Law 25 / GDPR).
// - player.js from the original embed snippet is NOT needed (no JS API
//   calls here) and would require loosening script-src in the CSP.
//
// CSP: next.config.mjs must allow https://player.vimeo.com in frame-src.
// The poster comes from i.vimeocdn.com, already covered by img-src https:.
import { useState } from "react"
import { Play } from "lucide-react"

const VIDEO_ID = "1236260454"
const TITLE = "Mediacrater demo: scanning video and image ads for policy issues"
// If you replace the video on Vimeo, update this from the video's og:image.
const POSTER =
  "https://i.vimeocdn.com/video/2212707486-88f0143b8fbcf73ed11bca12570af76b656b04a138b0a1d134e808bf27ee1e34-d?f=webp&region=us"

const PLAYER_SRC = `https://player.vimeo.com/video/${VIDEO_ID}?${new URLSearchParams({
  autoplay: "1", // the visitor clicked, so start with sound
  dnt: "1",
  badge: "0",
  byline: "0",
  portrait: "0",
  title: "0",
}).toString()}`

export function DemoVideo() {
  const [playing, setPlaying] = useState(false)

  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-2xl border border-border bg-black shadow-xl shadow-foreground/5">
      {playing ? (
        <iframe
          src={PLAYER_SRC}
          title={TITLE}
          allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
          referrerPolicy="strict-origin-when-cross-origin"
          className="absolute inset-0 h-full w-full"
        />
      ) : (
        <button
          type="button"
          onClick={() => setPlaying(true)}
          aria-label="Play the 2-minute Mediacrater demo"
          className="group absolute inset-0 h-full w-full focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-inset focus-visible:ring-ring"
        >
          <img
            src={POSTER}
            alt=""
            width={1280}
            height={720}
            loading="lazy"
            decoding="async"
            // If Vimeo's thumbnail ever fails, show the plain dark frame instead of a broken image.
            onError={(e) => {
              e.currentTarget.style.display = "none"
            }}
            className="h-full w-full object-cover opacity-90 transition-opacity group-hover:opacity-100 motion-reduce:transition-none"
          />
          <span className="absolute inset-0 flex items-center justify-center">
            <span className="flex items-center gap-3 rounded-full bg-primary px-6 py-3 text-base font-semibold text-primary-foreground shadow-lg transition-transform group-hover:scale-105 motion-reduce:transition-none">
              <Play aria-hidden="true" className="h-5 w-5 fill-current" />
              Watch the demo (2 min)
            </span>
          </span>
        </button>
      )}
    </div>
  )
}
