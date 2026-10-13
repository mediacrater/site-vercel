//lib/tools/cta.ts
/** Builds the single CTA link for a tool. `src` is what signup should store for attribution. */
export function signupUrl(slug: string): string {
  const params = new URLSearchParams({
    src: slug,
    utm_source: "free-tool",
    utm_medium: "cta",
    utm_campaign: slug,
  })
  return `/signup?${params.toString()}`
}
