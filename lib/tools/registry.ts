//lib/tools/registry.ts
export type ToolStatus = "draft" | "live"

export interface ToolDef {
  slug: string
  name: string // H1 and link label
  title: string // <title>, 60 characters or fewer
  description: string // meta description, 155 characters or fewer
  ctaText: string
  status: ToolStatus
  lastVerified: string // ISO date the rules/specs were last checked against official sources
}

export const TOOLS: ToolDef[] = [
  { slug: "meta-ad-copy-checker", name: "Ad Copy Policy Pre-Check", title: "Free Meta Ad Copy Policy Checker | Mediacrater", description: "Paste your ad copy and see phrases likely to trigger Meta or TikTok policy review, with the rule behind each flag. Runs in your browser.", ctaText: "Copy is only part of the ad. Scan the full creative", status: "draft", lastVerified: "2026-10-12" },
  { slug: "ad-script-checker", name: "Video Ad Script & Voiceover Checker", title: "Free UGC Ad Script Policy Checker | Mediacrater", description: "Check a UGC script or subtitle file for risky claims with timestamps, plus hook and runtime estimates. No signup, nothing uploaded.", ctaText: "Scan the finished video", status: "draft", lastVerified: "2026-10-12" },
  { slug: "ad-creative-spec-checker", name: "Ad Creative Spec Checker", title: "Ad Video & Image Spec Checker (Meta, TikTok) | Mediacrater", description: "Drop a video or image to check resolution, aspect ratio, codec, bitrate and size against Meta, TikTok and YouTube specs. Nothing uploaded.", ctaText: "Specs pass. Now check the content", status: "draft", lastVerified: "2026-10-12" },
  { slug: "meta-safe-zone-checker", name: "Meta Safe Zone Checker", title: "Reels & Stories Safe Zone Checker | Mediacrater", description: "Upload a creative and see Meta's Reels, Stories and Feed UI overlays on top of it. Check text placement before you publish.", ctaText: "Layout is clear. Is the message compliant?", status: "draft", lastVerified: "2026-10-12" },
  { slug: "tiktok-safe-zone-checker", name: "TikTok Safe Zone Checker", title: "TikTok Ad Safe Zone Checker | Mediacrater", description: "See TikTok's in-feed UI over your creative, adjusted for caption length. Check text placement in seconds, in your browser.", ctaText: "Placement checked. Scan for TikTok policy risk", status: "draft", lastVerified: "2026-10-12" },
  { slug: "ad-policy-checklist", name: "Ad Policy Readiness Checklist", title: "Meta Ad Policy Pre-Launch Checklist | Mediacrater", description: "A self-check of your creative, copy and landing page before launch. Get a list of gaps linked to official policies. Not a prediction.", ctaText: "Checklist done. Scan the creative itself", status: "draft", lastVerified: "2026-10-12" },
  { slug: "ad-claim-rules", name: "Ad Claim Rules by Industry", title: "What Ad Claims Are Allowed? Meta & TikTok | Mediacrater", description: "Allowed, restricted and prohibited claim examples for supplements, skincare, weight loss and finance ads, with official sources.", ctaText: "Check your creative against these rules", status: "draft", lastVerified: "2026-10-12" },
  { slug: "meta-ad-text-length-checker", name: "Ad Text Length & Truncation Preview", title: "Meta Ad Character Limit & Truncation Preview | Mediacrater", description: "Preview where your primary text and headline get cut off on each Meta placement, using Meta's per-placement guidance.", ctaText: "Your text fits. Will it pass review?", status: "draft", lastVerified: "2026-10-12" },
  { slug: "video-metadata-remover", name: "Media Metadata Inspector & Cleaner", title: "Remove Video & Photo Metadata Free (No Upload) | Mediacrater", description: "See the GPS, device, author and software data in your video or image, then download a clean copy. Processed on your device.", ctaText: "File cleaned. Check the content before launch", status: "draft", lastVerified: "2026-10-12" },
  { slug: "break-even-roas-calculator", name: "Ecommerce Ads Profit Calculator", title: "Break-Even ROAS & CPA Calculator | Mediacrater", description: "Calculate break-even ROAS, target ROAS, max CPA and max CPC from contribution margin, with the formulas shown. No signup.", ctaText: "Margins assume the ad gets approved. Scan it first", status: "draft", lastVerified: "2026-10-12" },
]

export const liveTools = (): ToolDef[] => TOOLS.filter((t) => t.status === "live")

export function getTool(slug: string): ToolDef {
  const tool = TOOLS.find((t) => t.slug === slug)
  if (!tool) throw new Error(`Unknown tool slug: ${slug}`)
  return tool
}
