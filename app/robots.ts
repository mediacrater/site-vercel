//app/robots.ts
import type { MetadataRoute } from "next"

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // /db is the Supabase rewrite in next.config.mjs. It should never be crawled.
      disallow: ["/api/", "/db/", "/dashboard", "/settings", "/scan-history", "/auth/"],
    },
    sitemap: "https://mediacrater.com/sitemap.xml",
  }
}
