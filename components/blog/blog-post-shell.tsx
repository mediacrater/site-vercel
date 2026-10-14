//components/blog/blog-post-shell.tsx
import Link from "next/link"
import type { ReactNode } from "react"
import { Header } from "@/components/header"
import { Footer } from "@/components/footer"
import { JsonLd } from "@/components/tools/json-ld"
import { blogSignupUrl, formatPostDate, livePosts, type PostDef } from "@/lib/blog/registry"

const SITE = "https://mediacrater.com"

interface BlogPostShellProps {
  post: PostDef
  disclosure: ReactNode // shown above the body, e.g. "I founded Mediacrater"
  ctaText: string
  children: ReactNode // the post body, built from components/blog/prose.tsx
}

export function BlogPostShell({ post, disclosure, ctaText, children }: BlogPostShellProps) {
  const url = `${SITE}/blog/${post.slug}`
  const related = livePosts().filter((p) => p.slug !== post.slug).slice(0, 3)
  const wasUpdated = post.updatedAt !== post.publishedAt

  return (
    <>
      <Header />
      <main className="mx-auto max-w-3xl px-4 pt-28 pb-16 sm:px-6">
        <JsonLd
          data={{
            "@context": "https://schema.org",
            "@graph": [
              {
                "@type": "BlogPosting",
                headline: post.headline,
                description: post.description,
                url,
                mainEntityOfPage: { "@type": "WebPage", "@id": url },
                datePublished: post.publishedAt,
                dateModified: post.updatedAt,
                inLanguage: "en",
                image: [`${SITE}/images/og-image.png`],
                author: {
                  "@type": post.author.type,
                  name: post.author.name,
                  url: post.author.url ? `${SITE}${post.author.url}` : undefined,
                },
                publisher: {
                  "@type": "Organization",
                  name: "Mediacrater",
                  url: SITE,
                  logo: { "@type": "ImageObject", url: `${SITE}/images/header-logo.png` },
                },
              },
              {
                "@type": "BreadcrumbList",
                itemListElement: [
                  { "@type": "ListItem", position: 1, name: "Home", item: SITE },
                  { "@type": "ListItem", position: 2, name: "Blog", item: `${SITE}/blog` },
                  { "@type": "ListItem", position: 3, name: post.headline, item: url },
                ],
              },
            ],
          }}
        />

        {post.status === "draft" && (
          <div role="note" className="mb-6 rounded-lg border border-yellow-400 bg-yellow-100 p-4 text-sm text-neutral-900">
            Draft. This page is hidden from search, the blog list and the sitemap. Replace every highlighted
            placeholder, then set the status to &quot;live&quot; in lib/blog/registry.ts.
          </div>
        )}

        <nav aria-label="Breadcrumb" className="text-xs text-muted-foreground">
          <Link href="/blog" className="hover:underline">Blog</Link> / {post.headline}
        </nav>

        <article className="mt-3">
          <header>
            <h1 className="font-[family-name:var(--font-display)] text-3xl font-bold leading-tight tracking-[-0.03em] text-foreground text-balance sm:text-[2.75rem]">
              {post.headline}
            </h1>
            <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted-foreground">
              <span>
                Published <time dateTime={post.publishedAt}>{formatPostDate(post.publishedAt)}</time>
              </span>
              {wasUpdated && (
                <span>
                  Updated <time dateTime={post.updatedAt}>{formatPostDate(post.updatedAt)}</time>
                </span>
              )}
              <span>{post.readingMinutes} min read</span>
            </div>
          </header>

          <div className="mt-8 border-l-2 border-primary pl-4 text-sm leading-relaxed text-muted-foreground">
            {disclosure}
          </div>

          <div className="mt-6">{children}</div>
        </article>

        <section aria-label="Try Mediacrater" className="mt-14 rounded-xl border border-border bg-card p-6">
          <p className="font-semibold text-foreground">{ctaText}</p>
          <Link
            href={blogSignupUrl(post.slug)}
            className="mt-4 inline-flex w-full items-center justify-center rounded-lg bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground hover:opacity-90 sm:w-auto"
          >
            Scan your creative with Mediacrater
          </Link>
          <p className="mt-2 text-xs text-muted-foreground">3 free scans every month. No credit card.</p>
        </section>

        {related.length > 0 && (
          <section className="mt-12">
            <h2 className="text-xl font-bold">More from the blog</h2>
            <ul className="mt-3 grid gap-2 sm:grid-cols-2">
              {related.map((p) => (
                <li key={p.slug}>
                  <Link href={`/blog/${p.slug}`} className="block rounded-lg border border-border p-3 text-sm hover:bg-card">
                    {p.headline}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
      <Footer />
    </>
  )
}
