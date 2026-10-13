//lib/tools/registry.ts
export type ToolStatus = "live"

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
  { slug: "video-metadata-remover", name: "Remove Metadata From Videos and Photos", title: "Remove Video & Photo Metadata Free (No Upload) | Mediacrater", description: "See the GPS, device, author and software data in your video or image, then download a clean copy. Processed on your device.", ctaText: "File cleaned. Check the content before launch", status: "live", lastVerified: "2026-10-12" },
  { slug: "break-even-roas-calculator", name: "Ecommerce Ads Profit Calculator", title: "Break-Even ROAS & CPA Calculator | Mediacrater", description: "Calculate break-even ROAS, target ROAS, max CPA and max CPC from contribution margin, with the formulas shown. No signup.", ctaText: "Margins assume the ad gets approved. Scan it first", status: "live", lastVerified: "2026-10-12" },
  { slug: "facebook-ad-rejected-no-reason", name: "Facebook Ad Rejected With No Reason? Find Likely Causes", title: "Facebook Ad Rejected With No Reason? | Mediacrater", description: "Facebook rejected your ad without saying why? Tick what's in it to see which Meta policies likely apply, with official links. Free, no signup.", ctaText: "Meta won't tell you which part caused it. Scan the ad to find likely triggers.", status: "live", lastVerified: "2026-10-12" },
]

export const liveTools = (): ToolDef[] => TOOLS.filter((t) => t.status === "live")

export function getTool(slug: string): ToolDef {
  const tool = TOOLS.find((t) => t.slug === slug)
  if (!tool) throw new Error(`Unknown tool slug: ${slug}`)
  return tool
}
