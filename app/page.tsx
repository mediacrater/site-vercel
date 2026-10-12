import { Header } from "@/components/header"
import { Hero } from "@/components/hero"
import { AdAccountInsurance } from "@/components/ad-account-insurance"
import { SocialProof } from "@/components/social-proof"
import { Features } from "@/components/features"
import { HowItWorks } from "@/components/how-it-works"
import { Pricing } from "@/components/pricing"
import { FAQ } from "@/components/faq"
import { CTA } from "@/components/cta"
import { Footer } from "@/components/footer"
import { VerificationDialog } from "@/components/verification-dialog"
import type { Metadata } from "next"

export const metadata: Metadata = {
  alternates: { canonical: "/" },
}

export default function Home() {
  return (
    <main>
      <Header />
      <VerificationDialog />
      <Hero />
      <AdAccountInsurance />
      <SocialProof />
      <Features />
      <HowItWorks />
      <Pricing />
      <FAQ />
      <CTA />
      <Footer />
    </main>
  )
}
