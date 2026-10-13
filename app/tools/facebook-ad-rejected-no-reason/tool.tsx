//app/tools/facebook-ad-rejected-no-reason/tool.tsx
"use client"

import { useMemo, useState } from "react"

// ---------------------------------------------------------------------------
// DATA
// Each "signal" is something the user can tick. Each signal points to one or
// more Meta policy areas. To edit the tool's content, edit these two lists.
// Keep every claim checkable against Meta's published Advertising Standards.
// ---------------------------------------------------------------------------

const META_STANDARDS = "https://transparency.meta.com/policies/ad-standards/"
const META_PERSONAL_ATTRIBUTES =
  "https://transparency.meta.com/policies/ad-standards/objectionable-content/privacy-violations-personal-attributes/"

type AreaId =
  | "personal" | "health" | "misleading" | "lowquality" | "adult" | "shocking"
  | "ip" | "restricted" | "prohibited" | "special" | "landing" | "rereview"

const AREAS: Record<AreaId, { name: string; summary: string; url: string }> = {
  personal: {
    name: "Personal attributes",
    summary: "Ads can't imply they know something personal about the viewer, such as their health, finances, body, age, religion or identity.",
    url: META_PERSONAL_ATTRIBUTES,
  },
  health: {
    name: "Health and wellness",
    summary: "Detailed rules for weight loss, supplements, cosmetic products and procedures, health claims, and how bodies are shown.",
    url: META_STANDARDS,
  },
  misleading: {
    name: "Misleading or deceptive claims",
    summary: "Claims, prices, testimonials or results that can't be backed up or don't match what people actually get.",
    url: META_STANDARDS,
  },
  lowquality: {
    name: "Low quality or disruptive content",
    summary: "Clickbait, sensational wording, fake interface elements and poor landing page experiences.",
    url: META_STANDARDS,
  },
  adult: {
    name: "Adult content and sexual suggestiveness",
    summary: "Nudity, implied nudity, and images focused on body parts, even when nothing explicit is shown.",
    url: META_STANDARDS,
  },
  shocking: {
    name: "Shocking or graphic content",
    summary: "Blood, injuries, medical procedures and other images meant to shock or scare.",
    url: META_STANDARDS,
  },
  ip: {
    name: "Intellectual property and impersonation",
    summary: "Other brands' logos or content, copyrighted music, and public figures used without permission.",
    url: META_STANDARDS,
  },
  restricted: {
    name: "Restricted goods and services",
    summary: "Allowed only with extra requirements, such as permission from Meta, certification, licences or age targeting.",
    url: META_STANDARDS,
  },
  prohibited: {
    name: "Prohibited goods and services",
    summary: "Products that can't be advertised at all. Editing the ad won't fix this.",
    url: META_STANDARDS,
  },
  special: {
    name: "Special Ad Categories and social issues",
    summary: "Housing, employment, credit, and ads about social issues, elections or politics must be declared in Ads Manager. Social issue ads also need authorization and a disclaimer.",
    url: META_STANDARDS,
  },
  landing: {
    name: "Landing page",
    summary: "Meta reviews where your ad leads, not only the ad itself.",
    url: META_STANDARDS,
  },
  rereview: {
    name: "Re-review after approval",
    summary: "Ads can be reviewed again at any time, including after edits, so an approved ad can still be rejected later.",
    url: META_STANDARDS,
  },
}

type Group = "Ad copy" | "Image or video" | "What you sell" | "Landing page" | "Ad history"
const GROUPS: Group[] = ["Ad copy", "Image or video", "What you sell", "Landing page", "Ad history"]

interface Signal {
  id: string
  group: Group
  label: string
  example?: string
  areas: AreaId[]
  check: string
}

const SIGNALS: Signal[] = [
  // Ad copy
  { id: "you-attribute", group: "Ad copy", label: "Says “you” or “your” next to a health condition, body feature, money situation, age or identity", example: "“Struggling with your weight?” “Tired of being in debt?”", areas: ["personal"], check: "Describe the product, not the viewer: “Our debt coaching program” instead of “Tired of being in debt?”" },
  { id: "health-claim", group: "Ad copy", label: "Promises health results, cures or specific weight loss", example: "“Lose 10 kg in 30 days”", areas: ["health", "misleading"], check: "Remove specific numbers and timelines, and any claim to cure, treat or prevent a condition." },
  { id: "income", group: "Ad copy", label: "Promises earnings or financial results", example: "“Make $5,000 a month from home”", areas: ["misleading"], check: "Remove guaranteed or specific income figures. Describe what the product is, not what the viewer will earn." },
  { id: "urgency", group: "Ad copy", label: "Uses countdowns, low-stock warnings or deadlines that aren't real", example: "“Only 2 left!” on an item that's always in stock", areas: ["misleading", "lowquality"], check: "Keep only real deadlines and stock levels, and make sure they match your landing page." },
  { id: "sensational", group: "Ad copy", label: "Clickbait or sensational wording", example: "“You won't believe…”, “Doctors hate this”, ALL CAPS, lots of !!!", areas: ["lowquality"], check: "Say what the product is and what it does in plain words." },

  // Image or video
  { id: "before-after", group: "Image or video", label: "Before-and-after comparison of a body, face or skin", areas: ["health"], check: "Check the current Health and Wellness rules for your product type before using these images. They're strict and detailed." },
  { id: "body-focus", group: "Image or video", label: "Close-ups of body parts or skin, or revealing clothing", areas: ["adult", "health"], check: "Show the product in use without zooming in on bodies, and avoid poses that could read as sexual." },
  { id: "fake-ui", group: "Image or video", label: "Fake buttons, play icons, notification badges or system messages", areas: ["lowquality", "misleading"], check: "Remove anything that looks clickable but isn't the real ad button." },
  { id: "shocking", group: "Image or video", label: "Blood, injuries, medical procedures or deliberately scary images", areas: ["shocking"], check: "Replace with non-graphic visuals." },
  { id: "brand-celeb", group: "Image or video", label: "Other brands' logos, celebrities, news-site styling or popular music", areas: ["ip", "misleading"], check: "Use only assets you own or have licensed, and never imply an endorsement you don't have." },
  { id: "testimonials", group: "Image or video", label: "Testimonials, reviews or results that aren't real or typical", areas: ["misleading"], check: "Use only real customers' words and results people can actually expect." },
  { id: "in-video-text", group: "Image or video", label: "On-screen text or voiceover says more than the ad copy does", areas: ["personal", "health", "misleading"], check: "Review covers what's shown and said inside the image or video, not only the text fields. Check every caption and spoken line." },

  // What you sell
  { id: "supplements", group: "What you sell", label: "Supplements, weight loss products, or cosmetic products and procedures", areas: ["health", "restricted"], check: "These come with extra rules on claims, images and age targeting." },
  { id: "restricted", group: "What you sell", label: "Alcohol, gambling, dating, financial services, crypto, or an online pharmacy", areas: ["restricted"], check: "Some of these need permission or certification from Meta before advertising, others need age targeting. Check the requirement for your category." },
  { id: "prohibited", group: "What you sell", label: "Tobacco or vapes, weapons or ammunition, illegal or recreational drugs, or adult products", areas: ["prohibited"], check: "Ads for these generally aren't allowed at all, so changing the creative won't fix it." },
  { id: "special", group: "What you sell", label: "Housing, jobs, loans or credit, or anything political or about social issues", areas: ["special"], check: "Declare the Special Ad Category when creating the campaign. Social issue ads also need authorization." },

  // Landing page
  { id: "lp-mismatch", group: "Landing page", label: "Shows a different product, price or offer than the ad", areas: ["landing", "misleading"], check: "Make the product, price and offer match the ad exactly." },
  { id: "lp-quality", group: "Landing page", label: "Slow, broken, full of pop-ups, or redirects somewhere else", areas: ["landing", "lowquality"], check: "Test it on a phone, and remove automatic redirects and intrusive pop-ups." },
  { id: "lp-trust", group: "Landing page", label: "No contact details, privacy policy or refund policy on the site", areas: ["landing"], check: "Add clear contact information and the policies a customer would expect." },
  { id: "lp-other-products", group: "Landing page", label: "The site also sells or links to restricted or prohibited products", areas: ["landing", "restricted"], check: "Meta reviews the landing page too, including what else it sells. Remove or separate those products." },

  // Ad history
  { id: "edited-live", group: "Ad history", label: "It was approved and running, then rejected after you edited it", areas: ["rereview"], check: "Edits send the ad back into review. Compare exactly what changed." },
  { id: "ran-then-rejected", group: "Ad history", label: "It ran fine, then got rejected without any changes", areas: ["rereview"], check: "Ads can be re-reviewed at any time, for example after people hide or report them. The original content is judged again." },
]

const AREA_ORDER = Object.keys(AREAS) as AreaId[]

// ---------------------------------------------------------------------------
// COMPONENT
// ---------------------------------------------------------------------------

export function RejectionTriage() {
  const [ticked, setTicked] = useState<Set<string>>(new Set())

  const toggle = (id: string) =>
    setTicked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  // Group ticked signals by policy area; most matches first.
  const results = useMemo(() => {
    const byArea = new Map<AreaId, Signal[]>()
    for (const s of SIGNALS) {
      if (!ticked.has(s.id)) continue
      for (const a of s.areas) byArea.set(a, [...(byArea.get(a) ?? []), s])
    }
    return [...byArea.entries()].sort(
      (a, b) => b[1].length - a[1].length || AREA_ORDER.indexOf(a[0]) - AREA_ORDER.indexOf(b[0])
    )
  }, [ticked])

  return (
    <div className="rounded-xl border border-border bg-card p-4 sm:p-6">
      <p className="text-sm font-semibold">Tick everything that's true about your rejected ad</p>

      <div className="mt-4 space-y-6">
        {GROUPS.map((group) => (
          <fieldset key={group}>
            <legend className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{group}</legend>
            <div className="mt-2 space-y-2">
              {SIGNALS.filter((s) => s.group === group).map((s) => (
                <label
                  key={s.id}
                  className="flex cursor-pointer gap-3 rounded-lg border border-border bg-background p-3 hover:border-primary"
                >
                  <input
                    type="checkbox"
                    checked={ticked.has(s.id)}
                    onChange={() => toggle(s.id)}
                    className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--primary)]"
                  />
                  <span className="text-sm">
                    {s.label}
                    {s.example && <span className="mt-0.5 block text-xs text-muted-foreground">e.g. {s.example}</span>}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        ))}
      </div>

      <div aria-live="polite" className="mt-8 border-t border-border pt-6">
        {results.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Tick what's in your ad to see which policy areas it most likely falls under.
          </p>
        ) : (
          <>
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-semibold">Most likely policy areas</p>
              <button
                type="button"
                onClick={() => setTicked(new Set())}
                className="text-xs text-muted-foreground underline hover:text-foreground"
              >
                Clear all
              </button>
            </div>

            <ol className="mt-4 space-y-4">
              {results.map(([areaId, signals]) => {
                const area = AREAS[areaId]
                return (
                  <li key={areaId} className="rounded-lg border border-border bg-background p-4">
                    <div className="flex items-baseline justify-between gap-3">
                      <h3 className="font-semibold">{area.name}</h3>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {signals.length} {signals.length === 1 ? "match" : "matches"}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">{area.summary}</p>
                    <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm">
                      {signals.map((s) => <li key={s.id}>{s.check}</li>)}
                    </ul>
                    <a
                      href={area.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-3 inline-block text-xs font-medium text-primary hover:underline"
                    >
                      Read Meta's policy →
                    </a>
                  </li>
                )
              })}
            </ol>

            <p className="mt-4 text-xs text-muted-foreground">
              These are common causes based on what you ticked, not a diagnosis. Meta doesn't say which part of an ad
              triggered a rejection, so more than one of these may apply, or none of them.
            </p>
          </>
        )}
      </div>
    </div>
  )
}
