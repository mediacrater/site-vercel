//app/blog/how-i-minimized-meta-ad-account-bans/page.tsx
import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { BlogPostShell } from "@/components/blog/blog-post-shell"
import { A, Callout, H2, LI, P, UL } from "@/components/blog/prose"
import { blogSignupUrl, getPost, isPostVisible } from "@/lib/blog/registry"

const post = getPost("how-i-minimized-meta-ad-account-bans")
const path = `/blog/${post.slug}`

export const metadata: Metadata = {
  title: post.title,
  description: post.description,
  alternates: { canonical: path },
  // Drafts must never be indexed, even if someone finds the URL.
  robots: post.status === "draft" ? { index: false, follow: false } : undefined,
  // Child openGraph replaces the layout's openGraph entirely, so the image and site name are repeated here.
  openGraph: {
    title: post.title,
    description: post.description,
    url: path,
    type: "article",
    siteName: "Mediacrater",
    locale: "en_US",
    publishedTime: post.publishedAt,
    modifiedTime: post.updatedAt,
    images: [{ url: "/images/og-image.png", width: 1200, height: 630, alt: post.headline }],
  },
  twitter: {
    card: "summary_large_image",
    title: post.title,
    description: post.description,
    images: ["/images/og-image.png"],
  },
}

export default function Page() {
  if (!isPostVisible(post)) notFound()

  return (
    <BlogPostShell
      post={post}
      ctaText="Meta won't tell you which part of an ad caused a rejection. Check the creative before you upload it."
      disclosure={
        <>
          <p>
            Disclosure: I&apos;m the founder of Mediacrater, which is mentioned below. This post also contains
            affiliate links. If you buy through it, I earn a commission at no extra cost to you.
          </p>
          <p className="mt-2">
            Nothing here guarantees your account stays safe. Platform rules change, and everything below is based on
            patterns I&apos;ve seen in my own Meta accounts, not on anything Meta has confirmed.
          </p>
        </>
      }
    >
      <P>
        I&apos;ve run Meta ads since 2019 and had dozens of ad accounts banned, usually with no clear explanation
        from Meta. Figuring out why became trial and error. These are the three habits that came with fewer bans
        for me.
      </P>

      <H2 id="stable-ip">1. I stopped my IP address from changing</H2>
      <P>
        My internet provider rotated my home IP address every month, so my logins kept appearing from different
        addresses. After I switched to a fixed IP, the random bans that used to hit right after I logged in stopped.
      </P>
      <P>There are two ways to get a stable IP:</P>
      <UL>
        <LI>
          <strong>Ask your internet provider for a static IP.</strong> This is the safest route, because no third
          party sits between you and your ad account.
        </LI>
        <LI>
          <strong>Use a dedicated static residential IP from a service.</strong> I used{" "}
          <A href="https://www.myprivateproxy.net/billing/aff.php?aff=4193" sponsored>
            MyPrivateProxy
          </A>{" "}
          (affiliate link) for a long time.
        </LI>
      </UL>
      <P>
        At the same time, I also used an anti-detect browser,{" "}
        <A href="https://incogniton.com/aff/1929570/" sponsored>
          Incogniton
        </A>{" "}
        (affiliate link), which keeps your browser fingerprint consistent. Because I changed both at once, I
        can&apos;t tell you which one made the difference. It worked for me at the time, but it comes with
        risks. These tools are mostly used to run multiple accounts. Using accounts to get around a restriction is
        against Meta&apos;s rules, and the browser holds your login sessions. Honestly, I find Meta a bit
        hypocritical here. It bans circumvention, yet in my experience its enforcement mostly bans people who have
        no intention of circumventing anything and just want to make sales. I wouldn&apos;t have resorted to these
        tools and methods if Meta&apos;s enforcement were consistent and predictable.
      </P>
      <Callout title="If you use an IP service, know the risks">
        <p>
          You&apos;re routing your ad account logins through a third party. Shared or datacenter IPs may already be
          flagged because of what other people did on them. Pick a reputable provider, make sure the IP is dedicated
          to you, and turn on two-factor authentication on your Facebook account and Business Manager before you
          log in through it.
        </p>
      </Callout>

      <H2 id="payment-method">2. I waited 24 hours after changing my payment method</H2>
      <P>
        Whenever I updated a payment method, I held off spending for 24 hours unless I had to. I didn&apos;t want
        a new payment method and a sudden jump in spend to show up at the same time.
      </P>
      <P>
        Meta doesn&apos;t publish this as a rule. It&apos;s my own habit, and I&apos;m sharing it as one.
      </P>

      <H2 id="check-ads">3. I checked my ads before uploading them</H2>
      <P>
        Many rejections come from the creative itself, such as a line that sounds like a guaranteed result. This is
        why I built Mediacrater.
      </P>
      <P>
        Mediacrater scans video and image ads for likely Meta, TikTok and Google policy issues and shows findings with
        timestamps and suggested fixes. It can&apos;t guarantee approval and it doesn&apos;t check account-level
        problems like billing, verification or your landing page. What it does is flag creative risks before you put
        money behind an ad. You get <A href={blogSignupUrl(post.slug)}>3 free scans a month</A>.
      </P>

      <H2 id="limits">The honest limits</H2>
      <P>
        These habits worked for me for over a year, better than anything I&apos;d tried before. They&apos;re not a
        guarantee. I still had bans, and looking back, they came from things in my creatives I didn&apos;t know were
        a problem. Running my old ads through Mediacrater has shown me the likely issues I missed.
      </P>
      <P>
        For the official rules, read{" "}
        <A href="https://transparency.meta.com/policies/ad-standards/">Meta&apos;s Advertising Standards</A>, and
        treat everything above as one advertiser&apos;s experience.
      </P>
      <P>
        If you&apos;re deciding between renting an agency ad account and building your own,{" "}
        <A href="/#own-your-accounts">here&apos;s how the two compare</A>.
      </P>
    </BlogPostShell>
  )
}
