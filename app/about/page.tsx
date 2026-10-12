// app/about/page.tsx
import React from 'react';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react'; // or your icon library

export const metadata = {
  title: 'About Mediacrater – Built by a Former Dropshipper Who Got Burned',
  description: 'I lost thousands to unexplained Facebook ad bans. So I built Mediacrater: a simple, privacy-first tool to scan creatives for policy violations before upload. No AI hype. Just real help for media buyers.',
  openGraph: {
    title: 'About Mediacrater – From Bans to Better Ads',
    description: 'A former dropshipper turned builder. Tired of losing money to opaque ad rejections, I created a tool that actually helps avoid bans on Meta, TikTok, Google & more.',
    images: ['/images/about-og.png'], // add a 1200x630 image (you + dashboard screenshot recommended)
	  alternates: { canonical: '/about' },
  },
};

export default function AboutPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Hero Section */}
      <section className="py-16 md:py-24 border-b border-border">
        <div className="container max-w-4xl mx-auto px-6 text-center">
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight mb-6">
            I Got Banned. A Lot.
          </h1>
          <p className="text-xl text-muted-foreground max-w-3xl mx-auto mb-10">
            I used to run dropshipping ads. I lost thousands to sudden bans with zero clear explanation.  
            So I built something that actually helps media buyers avoid the same pain.
          </p>
        </div>
      </section>

      {/* Story Section */}
      <section className="py-16 md:py-24">
        <div className="container max-w-4xl mx-auto px-6">
          <div className="prose prose-lg prose-invert mx-auto">
            <h2 className="text-3xl font-bold mb-6">My Story</h2>
            
            <p>
              A few years ago I was deep in dropshipping. Like many, I spent hours testing products, writing copy, and burning ad budgets only to wake up to account restrictions or outright bans with no real feedback from Meta or TikTok.
            </p>

            <p>
			  I never found out what triggered the violations because I never got feedback. I learned the hard way which words, images, and claims were red flags. But you don't have to follow in my footsteps. One wrong creative could cost hundreds or thousands in lost revenue and wasted spend.
			</p>

            <p>
              Eventually I got tired of the guessing game. I wanted a tool that could scan an ad creative <em>before</em> I hit submit, something that would tell me exactly which policies I was breaking and why, so I could fix it and move on.
            </p>

            <p>
              Nothing like that existed at the price point or simplicity I needed. So I built it myself.
            </p>

            <h3 className="text-2xl font-bold mt-12 mb-4">What Mediacrater Actually Is</h3>
            
            <p>
              Mediacrater is a straightforward browser extension and web tool that lets media buyers, freelancers, and small agencies:
            </p>
            
            <ul className="list-disc pl-6 space-y-3">
              <li>Upload video or image creatives</li>
              <li>Select the platform (Meta, TikTok, Google Ads, YouTube, etc.)</li>
              <li>Get an instant list of policy violations (if any) + a confidence score</li>
              <li>Fix issues before wasting budget on rejected ads</li>
            </ul>

            <p className="mt-6">
              No AI hype. No black-box magic. Just clear, actionable feedback so you stop guessing and start scaling.
            </p>

            <h3 className="text-2xl font-bold mt-12 mb-4">Why Privacy-First Matters to Me</h3>
            
            <p>
              I hated how much data ad platforms already collect. I didn’t want to build something that made the problem worse. That’s why everything runs locally on your device. We don’t store your creatives for extended periods of time, and even then, it’s anonymized and deleted immediately.
            </p>

            <h3 className="text-2xl font-bold mt-12 mb-4">Who This Is For</h3>
            
            <p>
              Freelance media buyers, small agencies, DTC brands, and anyone running paid ads who’s tired of:
            </p>
            
            <ul className="list-disc pl-6 space-y-3">
              <li>Sudden account restrictions with zero explanation</li>
              <li>Wasting hours appealing vague violations</li>
              <li>Losing money on ads that never get approved</li>
            </ul>

            <div className="mt-12 p-6 border border-border rounded-lg bg-muted/30">
              <p className="text-lg font-medium text-center">
                If you've ever screamed at your screen after seeing "Ad rejected" this tool was built for you.
              </p>
            </div>

            <div className="mt-16 text-center">
              <Link
                href="/signup"
                className="inline-flex items-center px-8 py-4 bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 transition"
              >
                Start today - Get 3 Free Monthly Tokens
                <ArrowRight className="ml-2 h-5 w-5" />
              </Link>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
