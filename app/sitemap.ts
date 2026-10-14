//app/sitemap.ts
// Replaces public/sitemap.xml, which was missing pages and had to be edited by hand.
// Google ignores changefreq and priority, so only accurate lastModified dates are set.
import type { MetadataRoute } from "next"
import { liveTools } from "@/lib/tools/registry"
import { livePosts } from "@/lib/blog/registry"

const SITE = "https://mediacrater.com"

// Public, indexable pages only. Keep in sync with app/robots.ts (no /dashboard, /settings, etc.).
const STATIC_PATHS = [
  "/about",
  "/tools",
  "/solutions",
  "/changelog",
  "/privacy",
  "/chrome-extension-privacy",
  "/terms",
  "/refund",
  "/cookies",
]

export default function sitemap(): MetadataRoute.Sitemap {
  const posts = livePosts()
  const newestPostUpdate = posts.map((p) => p.updatedAt).sort().at(-1)

  return [
    { url: SITE },
    ...STATIC_PATHS.map((path) => ({ url: `${SITE}${path}` })),
    ...liveTools().map((t) => ({ url: `${SITE}/tools/${t.slug}`, lastModified: t.lastVerified })),
    ...(newestPostUpdate ? [{ url: `${SITE}/blog`, lastModified: newestPostUpdate }] : []),
    ...posts.map((p) => ({ url: `${SITE}/blog/${p.slug}`, lastModified: p.updatedAt })),
  ]
}
