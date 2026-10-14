//app/blog/page.tsx
import type { Metadata } from "next"
import Link from "next/link"
import { Header } from "@/components/header"
import { Footer } from "@/components/footer"
import { JsonLd } from "@/components/tools/json-ld"
import { formatPostDate, livePosts } from "@/lib/blog/registry"

const SITE = "https://mediacrater.com"
const posts = livePosts()

const title = "Ad Policy & Account Health Blog | Mediacrater"
const description =
  "Practical notes on ad policies, rejections and keeping Meta, TikTok and Google ad accounts healthy, written from real campaign experience."

export const metadata: Metadata = {
  title,
  description,
  alternates: { canonical: "/blog" },
  // An empty list is a thin page, so keep it out of search until the first post is live.
  robots: posts.length === 0 ? { index: false, follow: true } : undefined,
  openGraph: {
    title,
    description,
    url: "/blog",
    type: "website",
    siteName: "Mediacrater",
    locale: "en_US",
    images: [{ url: "/images/og-image.png", width: 1200, height: 630, alt: "Mediacrater blog" }],
  },
}

export default function BlogIndex() {
  return (
    <>
      <Header />
      <main className="mx-auto max-w-3xl px-4 pt-28 pb-16 sm:px-6">
        <JsonLd
          data={{
            "@context": "https://schema.org",
            "@type": "Blog",
            name: "Mediacrater blog",
            url: `${SITE}/blog`,
            description,
            publisher: { "@type": "Organization", name: "Mediacrater", url: SITE },
            blogPost: posts.map((p) => ({
              "@type": "BlogPosting",
              headline: p.headline,
              url: `${SITE}/blog/${p.slug}`,
              datePublished: p.publishedAt,
              dateModified: p.updatedAt,
            })),
          }}
        />

        <h1 className="font-[family-name:var(--font-display)] text-4xl font-bold tracking-[-0.035em]">Blog</h1>
        <p className="mt-3 max-w-2xl text-muted-foreground">
          What I&apos;ve learned running paid ads: policies, rejections and keeping ad accounts healthy. No guarantees,
          just what worked and what didn&apos;t.
        </p>

        {posts.length === 0 ? (
          <div className="mt-10 rounded-xl border border-border bg-card p-6">
            <p className="font-semibold">No posts yet.</p>
            <p className="mt-2 text-sm text-muted-foreground">
              In the meantime, the{" "}
              <Link href="/tools" className="font-medium text-primary underline underline-offset-4">free tools</Link>{" "}
              cover common rejection causes.
            </p>
          </div>
        ) : (
          <ul className="mt-10 divide-y divide-border border-y border-border">
            {posts.map((p) => (
              <li key={p.slug} className="py-6">
                <Link href={`/blog/${p.slug}`} className="group block">
                  <h2 className="font-[family-name:var(--font-display)] text-xl font-bold text-foreground group-hover:text-primary">
                    {p.headline}
                  </h2>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{p.excerpt}</p>
                  <p className="mt-3 text-xs text-muted-foreground">
                    <time dateTime={p.publishedAt}>{formatPostDate(p.publishedAt)}</time>
                    <span className="ml-4">{p.readingMinutes} min read</span>
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
      <Footer />
    </>
  )
}
