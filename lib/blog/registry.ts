//lib/blog/registry.ts
// Single source of truth for blog posts. The /blog index, the sitemap, the
// homepage link and each post page all read from here.

export type PostStatus = "draft" | "live"

export interface PostAuthor {
  type: "Person" | "Organization"
  name: string
  url?: string // site-relative, e.g. "/about"
}

export interface PostDef {
  slug: string
  headline: string // H1, shown on the page and on /blog
  title: string // <title>, 60 characters or fewer
  description: string // meta description, 155 characters or fewer
  excerpt: string // one or two sentences for the /blog list
  publishedAt: string // ISO date (YYYY-MM-DD), the day it goes live
  updatedAt: string // ISO date, change only for real content edits
  author: PostAuthor
  readingMinutes: number
  status: PostStatus
}

export const POSTS: PostDef[] = [
  {
    slug: "how-i-minimized-meta-ad-account-bans",
    headline: "How I Minimized Ad Account Bans on Meta",
    title: "How I Minimized Ad Account Bans on Meta | Mediacrater",
    description:
      "What I changed after repeated Meta ad account bans: a stable IP, a 24-hour wait after payment changes, and checking ads before upload. No guarantees.",
    excerpt:
      "Three habits I adopted after losing Meta ad accounts, what I can and can't prove about them, and the risks of each.",
    publishedAt: "2026-10-14",
    updatedAt: "2026-10-14",
    // Switch to { type: "Person", name: "Your Real Name", url: "/about" } if you want a personal byline.
    author: { type: "Organization", name: "Mediacrater", url: "/about" },
    readingMinutes: 4,
    status: "live",
  },
]

// Drafts are hidden everywhere unless SHOW_DRAFT_POSTS=true is set on the
// Vercel project (set it on the TEST project only). Read at build time.
const SHOW_DRAFTS = process.env.SHOW_DRAFT_POSTS === "true"

/** Live posts, newest first. Drafts never appear in lists or the sitemap. */
export function livePosts(): PostDef[] {
  return POSTS.filter((p) => p.status === "live").sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
}

/** Whether a post's page should render at all (live, or draft on the test site). */
export function isPostVisible(post: PostDef): boolean {
  return post.status === "live" || SHOW_DRAFTS
}

export function getPost(slug: string): PostDef {
  const post = POSTS.find((p) => p.slug === slug)
  if (!post) throw new Error(`Unknown blog slug: ${slug}`)
  return post
}

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "long",
  day: "numeric",
  timeZone: "UTC",
})

/** "2026-10-14" -> "October 14, 2026". UTC so the date never shifts by timezone. */
export function formatPostDate(iso: string): string {
  return dateFormatter.format(new Date(`${iso}T00:00:00Z`))
}

/** Signup link with attribution, matching the pattern in lib/tools/cta.ts. */
export function blogSignupUrl(slug: string): string {
  const params = new URLSearchParams({
    src: `blog-${slug}`,
    utm_source: "blog",
    utm_medium: "cta",
    utm_campaign: slug,
  })
  return `/signup?${params.toString()}`
}
