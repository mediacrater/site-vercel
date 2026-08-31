//app/terms/page.tsx
import type { Metadata } from 'next'
export const metadata: Metadata = {
  title: 'Terms of Service | Mediacrater',
  description: 'Terms of Service for Mediacrater. Understand your rights and responsibilities when using our ad policy scanning tool.',
  robots: { index: true, follow: true },
}
export default function TermsOfService() {
  return (
    <main className="max-w-3xl mx-auto px-6 py-16 text-base leading-relaxed">
      <h1 className="text-3xl font-bold mb-2">Terms of Service</h1>
      <p className="text-sm text-muted-foreground mb-10">Effective date: August 2026</p>
      <section className="mb-10">
        <h2 className="text-xl font-semibold mb-3">1. Acceptance of Terms</h2>
        <p>
          By installing or using Mediacrater, you agree to these Terms of Service. If you do not
          agree, do not use the service. Questions can be directed to{' '}
          <a href="mailto:hello.mediacrater@gmail.com" className="underline">
            hello.mediacrater@gmail.com
          </a>.
        </p>
      </section>
      <section className="mb-10">
        <h2 className="text-xl font-semibold mb-3">2. What Mediacrater Does</h2>
        <p>
          Mediacrater analyzes video and image ad creatives against publicly available advertising
          policies from platforms including Meta, TikTok, YouTube, Pinterest, and X, via our Chrome
          extension or web app. It returns a confidence score and actionable recommendations. It
          does not guarantee ad approval and is not affiliated with any of these platforms.
        </p>
      </section>
      <section className="mb-10">
        <h2 className="text-xl font-semibold mb-3">3. No Guarantees</h2>
        <p>
          Mediacrater provides a general confidence score based on publicly accessible ad policies.
          We do not guarantee that a scanned ad will be approved by any platform. Platform
          enforcement decisions are made by their own proprietary algorithms, which we do not
          replicate, mirror, or bypass. Results are for informational purposes only.
        </p>
      </section>
      <section className="mb-10">
        <h2 className="text-xl font-semibold mb-3">4. Token System</h2>
        <p className="mb-4">
          Access to scans is granted through a token system. Tokens are purchased in subscription tiers and
          consumed once per scan. Key rules:
        </p>
        <ul className="list-disc list-inside space-y-2">
          <li>Tokens reset at the end of the billing period</li>
          <li>Tokens are non-transferable and tied to your account</li>
          <li>Used tokens are non-refundable under any circumstances</li>
          <li>Unused tokens may be refundable, see our Refund Policy for details</li>
        </ul>
      </section>
      <section className="mb-10">
        <h2 className="text-xl font-semibold mb-3">5. Acceptable Use</h2>
        <p className="mb-4">By creating an account and verifying your email, you automatically agree <strong>not</strong> to:</p>
        <ul className="list-disc list-inside space-y-2">
          <li>Use Mediacrater to reverse-engineer, mimic or duplicate our business model</li>
          <li>Use Mediacrater to attempt to reverse-engineer or bypass platform ad detection systems</li>
          <li>Submit content that is illegal, harmful, or violates third-party rights</li>
          <li>Attempt to manipulate, scrape, or abuse the scanning infrastructure</li>
          <li>Resell or redistribute scan results without permission</li>
          <li>Create multiple free accounts to get around the free-plan allowance</li>
        </ul>
      </section>

      <section className="mb-10">
        <h2 className="text-xl font-semibold mb-3">6. Abuse</h2>
        <p className="mb-4">
          We want to keep our free plan for those who truly need it. Whether it's for the small dropshipper
          just starting out or a new media buyer running their first campaign of creatives, the free plan is for you.
        </p>
        <p className="mb-4">
          The free allowance is per person and per device, not per account. Extra accounts are allowed.
          If several free accounts appear to belong to the same person, they share that allowance until
          one of them is on a paid plan. Paid accounts are not limited this way — agencies and buyers
          who need a separate account per client are welcome to do that on a paid plan.
        </p>
        <p className="mb-4">
          To enforce this, we collect your IP address, a device cookie, and basic browser and device
          information when you sign up. We do not block VPNs. Using a VPN, including a different
          profile per client, is allowed. Details are in our{' '}
          <a href="https://mediacrater.com/privacy" className="underline">
            Privacy Policy
          </a>.
        </p>
        <p>
          If you believe your account was limited in error, contact us at{' '}
          <a href="mailto:hello.mediacrater@gmail.com" className="underline">
            hello.mediacrater@gmail.com
          </a>.
        </p>
      </section>
      <section className="mb-10">
        <h2 className="text-xl font-semibold mb-3">7. Your Content</h2>
        <p className="mb-4">
          You retain full ownership of any video or image files you submit. By submitting a file, you
          grant Mediacrater a limited, temporary license to process it for the purpose of delivering
          your scan results. The full file you upload is permanently deleted after results are
          returned — we do not retain your original video or image. We claim no ownership over your
          creative assets.
        </p>
        <p>
          <strong>Scan History (paid plans):</strong> if your plan includes Scan History, we retain a
          small, heavily compressed, low-resolution thumbnail (generated from the first frame of your
          video, or your image) so you can visually identify past scans in your history list. This
          thumbnail is intentionally too low-quality for any practical reuse of your creative — it
          exists solely for your own reference. It is deleted if you delete the associated scan, and
          is not retained if your plan does not include Scan History. Full scan results (the text
          analysis, not the creative itself) are retained as part of your Scan History for as long as
          your plan includes that feature.
        </p>
      </section>
      <section className="mb-10">
        <h2 className="text-xl font-semibold mb-3">8. Intellectual Property</h2>
        <p>
          All Mediacrater software, branding, and content is owned by Mediacrater. You may not
          copy, modify, or distribute any part of the service without written permission.
          Platform logos are displayed solely for user experience and remain the property
          of their respective owners.
        </p>
      </section>
      <section className="mb-10">
        <h2 className="text-xl font-semibold mb-3">9. Limitation of Liability</h2>
        <p>
          Mediacrater is provided "as is." We are not liable for ad rejections, account bans,
          revenue loss, or any other damages arising from your use of the service or reliance
          on scan results. Our total liability to you shall not exceed the amount you paid for
          your current token bundle.
        </p>
      </section>
      <section className="mb-10">
        <h2 className="text-xl font-semibold mb-3">10. Changes to the Service</h2>
        <p>
          We reserve the right to modify or discontinue the service at any time. We will make
          reasonable efforts to notify users of significant changes. Continued use after changes
          constitutes acceptance of the updated terms.
        </p>
      </section>
      <section>
        <h2 className="text-xl font-semibold mb-3">11. Contact</h2>
        <p>
          For questions about these terms, email{' '}
          <a href="mailto:hello.mediacrater@gmail.com" className="underline">
            hello.mediacrater@gmail.com
          </a>.
        </p>
      </section>
    </main>
  )
}
