import type { Metadata } from 'next'
export const metadata: Metadata = {
  title: 'Privacy Policy | Mediacrater',
  description: 'How Mediacrater handles your data. We scan your ads for policy violations and permanently delete the original files after.',
  robots: { index: true, follow: true },
}
export default function PrivacyPolicy() {
  return (
    <main className="max-w-3xl mx-auto px-6 py-16 text-base leading-relaxed">
      <h1 className="text-3xl font-bold mb-2">Privacy Policy</h1>
      <p className="text-sm text-muted-foreground mb-10">Effective date: August 2026</p>
      <section className="mb-10">
        <h2 className="text-xl font-semibold mb-3">Who We Are</h2>
        <p>
          Mediacrater scans video and image ads for policy violations across platforms including
          Meta, TikTok, YouTube, Pinterest, and X, via our Chrome extension or web app. We are
          operated as Mediacrater and can be reached at{' '}
          <a href="mailto:hello.mediacrater@gmail.com" className="underline">
            hello.mediacrater@gmail.com
          </a>.
        </p>
      </section>
      <section className="mb-10">
        <h2 className="text-xl font-semibold mb-3">What Data We Collect</h2>
        <p className="mb-4">
          We collect only what is necessary to operate the service. Below is a complete list of
          the data we collect, why we collect it, and how it is stored.
        </p>
        <h3 className="text-lg font-semibold mb-2">Account Data</h3>
        <ul className="list-disc list-inside space-y-2 mb-6">
          <li>
            <strong>Email address</strong> — collected at registration to identify your account
            and communicate with you about your service. Stored securely via Supabase.
          </li>
          <li>
            <strong>Token balance</strong> — the number of scan tokens available on your account.
            Updated after each scan and each purchase. Stored via Supabase.
          </li>
          <li>
            <strong>Purchase records</strong> — when you make a purchase, we store the session ID,
            number of tokens purchased, and purchase amount. This is used to credit your account
            correctly and to support refund requests. Stored via Supabase.
          </li>
          <li>
            <strong>Scan metadata</strong> — when you run a scan, we log the timestamp, tokens
            consumed, platform selected, content type (video or image), and analysis duration.
            No ad content, video files, or images are stored as part of this metadata. This data
            is used solely to diagnose technical issues and to evaluate refund requests. Stored
            via Supabase.
          </li>
          <li>
            <strong>File name</strong> — if your plan includes Scan History, we also store the
            original file name of your upload (e.g. "summer_sale_ad.mp4") so you can identify it
            in your History page. Not stored if your plan does not include Scan History.
          </li>
          <li>
            <strong>Queue metadata</strong> — Our queuing system is designed to allocate our limited
            server resources appropriately so everyone gets a chance to scan their ads. When you run
            a scan and you're placed in our queuing system, we generate a queue ID and your scan
            metadata is logged with it. This includes your plan, user ID, scan type, content type, status,
            timestamps, how long you waited in queue and payload size.
          </li>
          <li>
            <strong>Password</strong> — your password is encrypted using Supabase's authentication
            system. We cannot view, access, or modify your password at any time.
          </li>
          <li>
            <strong>Authentication tokens</strong> — session tokens used to keep you logged in are
            stored locally on your device (via Chrome's secure storage API in the extension, or your
            browser's local storage on the web app). They are never transmitted to or stored on our
            servers beyond what Supabase requires for session management.
          </li>
        </ul>
        <h3 className="text-lg font-semibold mb-2">Device and abuse-prevention data</h3>
        <p className="mb-4">
          We collect the following when you create an account on mediacrater.com, so we can keep
          the free plan fair. We do not use this data for advertising, and we do not track you on
          other websites. The Chrome extension does not collect this data.
        </p>
        <ul className="list-disc list-inside space-y-2 mb-6">
          <li>
            <strong>IP address and approximate location</strong> — IP address, country, city, and
            network provider, collected at account creation. Used only to prevent abuse of the free
            plan. Approximate location is derived from the IP address; it is not a street address.
          </li>
          <li>
            <strong>Device cookie</strong> — a first-party identifier stored in your browser so we
            can tell when several free accounts are created from the same device. It is not your
            login session and is not cleared when you sign out. See our{' '}
            <a href="https://mediacrater.com/cookie-policy" className="underline">
              Cookie Policy
            </a>.
          </li>
          <li>
            <strong>Browser and device information</strong> — browser name and version, operating
            system, timezone, and a technical identifier derived from those details. Used only to
            enforce the free plan across accounts.
          </li>
        </ul>
        <h3 className="text-lg font-semibold mb-2">Payment Data</h3>
        <ul className="list-disc list-inside space-y-2 mb-6">
          <li>
            <strong>Credit card and billing information</strong> — all payment processing is handled
            exclusively by Stripe. We never receive, store, or have access to your card details.
            Stripe is PCI-DSS compliant and maintains its own security standards.
          </li>
          <li>
            <strong>Purchase and transaction records</strong> — retained for 6 years
            from the end of the tax year in which the transaction occurred, as required
            by the Canada Revenue Agency for tax and accounting compliance. This applies
            even if you delete your account.
          </li>
        </ul>
        <h3 className="text-lg font-semibold mb-2">Creative Assets (video and image files)</h3>
        <ul className="list-disc list-inside space-y-2">
          <li>
            <strong>Video and image files</strong> — files you submit for scanning are transmitted
            to our servers solely for policy analysis. The full file is permanently and
            automatically deleted the moment your scan results are returned — we do not retain
            your original video or image.
          </li>
          <li>
            <strong>Scan History thumbnails (paid plans only)</strong> — if your plan includes
            Scan History, we additionally generate and retain a small, heavily compressed,
            low-resolution thumbnail — derived from your uploaded image, or the first frame of
            your video — solely so you can visually identify past scans in your History page.
            This thumbnail is intentionally too low-quality for any practical reuse of your
            creative. It is stored via Supabase Storage, deleted if you delete the associated
            scan, and is not generated or retained at all if your plan does not include Scan
            History. We do not use your creative assets, or any thumbnail derived from them, for
            any purpose beyond what is outlined in this Privacy Policy.
          </li>
        </ul>
      </section>
        <h3 className="text-lg font-semibold mb-2">Cloudflare usage</h3>
        <p className="mb-4">
          We use Cloudflare services (including Bot Fight Mode and related challenge mechanisms) 
          to protect our infrastructure against automated abuse and malicious traffic. These 
          services may process limited technical signals such as IP address, TLS fingerprint, and 
          User-Agent. For details on how Cloudflare handles this data, see Cloudflare’s Turnstile 
          Privacy Addendum:
        </p>
        <p className="mb-4">
              <a
                href="https://www.cloudflare.com/en-gb/turnstile-privacy-policy"
                target="_blank"
                rel="noopener noreferrer"
                className="mb-4 underline underline-offset-2 transition-all duration-300 hover:text-blue-400 hover:drop-shadow-[0_0_8px_rgba(59,130,246,0.8)]"
              >
                https://www.cloudflare.com/en-gb/turnstile-privacy-policy
              </a>
        </p>
      <section className="mb-10">
        <h2 className="text-xl font-semibold mb-3">AI model providers</h2>
        <ul className="list-disc list-inside space-y-2">
          <p>
            To analyze your ad content, we send your uploaded video or image, along with related 
            text instructions, to third-party AI model providers. We delete the original file from 
            our systems once your results are returned. Our providers do not use your content to train 
            their models without separate consent, but they may retain and store it, may process it in 
            countries other than your own, and may disclose it where required by law.
         </p>       
        </ul>
      </section>
      <section className="mb-10">
        <h2 className="text-xl font-semibold mb-3">How We Use Your Data</h2>
        <ul className="list-disc list-inside space-y-2">
          <li>To authenticate you and maintain your account session</li>
          <li>To scan your ad content and return a policy compliance report</li>
          <li>To manage your token balance accurately across purchases and scans</li>
          <li>To process payments and evaluate refund requests</li>
          <li>To diagnose technical issues using anonymised scan metadata</li>
          <li>To improve Mediacrater's accuracy and features over time</li>
          <li>To respond to support requests sent to our email</li>
          <li>To display scan history accurately for paying users</li>
          <li>To prevent abuse of the free plan and keep it available for people who need it</li>
        </ul>
      </section>
      <section className="mb-10">
        <h2 className="text-xl font-semibold mb-3">Data Sharing</h2>
        <p>
          We do not sell, rent, or share your personal data with third parties for marketing
          or advertising purposes. Data is shared only with the third-party service providers
          listed below, and only to the extent necessary to operate the service.
        </p>
      </section>
      <section className="mb-10">
        <h2 className="text-xl font-semibold mb-3">Third-Party Services</h2>
        <p className="mb-4">We use the following third-party services to operate Mediacrater:</p>
        <ul className="list-disc list-inside space-y-2">
          <li>
            <strong>Supabase</strong> — user authentication, account data storage, database
            management, and — for paid plans with Scan History enabled — storage of compressed
            scan thumbnails as described above.
          </li>
          <li>
            <strong>Stripe</strong> — payment processing. Stripe handles all credit card and
            billing data. We do not store payment details.
          </li>
          <li>
            <strong>Cloud infrastructure provider</strong> — server hosting and processing infrastructure.
          </li>
          <li>
            <strong>Vercel</strong> — website hosting and infrastructure for mediacrater.com.
          </li>
          <li>
            <strong>Vercel Analytics</strong> — anonymous usage analytics for our website.
            No personally identifiable information is collected.
          </li>
          <li>
            <strong>Network intelligence provider</strong> — we may send an IP address to a
            network intelligence service to derive approximate location (country and city) and
            connection type (for example, residential or data center). Used only for free-plan
            enforcement. We do not receive a street address.
          </li>
        </ul>
        <p className="mt-4">
          Each provider maintains their own privacy policies and security standards.
        </p>
      </section>
      <section className="mb-10">
        <h2 className="text-xl font-semibold mb-3">Data Retention</h2>
        <ul className="list-disc list-inside space-y-2">
          <li>
            <strong>Creative assets (full files)</strong> — deleted immediately and automatically
            after scan results are delivered.
          </li>
          <li>
            <strong>Scan History thumbnails</strong> — retained only for accounts on a plan that
            includes Scan History, for as long as the associated scan record exists. Not generated
            or retained on plans without Scan History.
          </li>
          <li>
            <strong>Account data</strong> — retained for as long as your account is active.
          </li>
          <li>
            <strong>Scan metadata</strong> — retained for as long as your account is active and
            used solely for diagnostics and refund evaluation.
          </li>
          <li>
            <strong>Purchase records</strong> — retained for as long as your account is active
            for billing and refund purposes.
          </li>
          <li>
            <strong>Device and abuse-prevention data</strong> — retained for as long as your
            account is active, and deleted when you delete your account.
          </li>
        </ul>
        <p className="mt-4">
          You may request deletion of your account and all associated data at any time by
          emailing us.
        </p>
      </section>
      <section className="mb-10">
        <h2 className="text-xl font-semibold mb-3">Your Rights</h2>
        <p className="mb-4">You have the right to:</p>
        <ul className="list-disc list-inside space-y-2">
          <li>Request a copy of the personal data we hold about you</li>
          <li>Request correction of inaccurate data</li>
          <li>Request deletion of your account and associated data</li>
          <li>Withdraw consent at any time by closing your account</li>
          <li>Lodge a complaint with your local data protection authority</li>
        </ul>
        <p className="mt-4">
          To exercise any of these rights, email us at{' '}
          <a href="mailto:hello.mediacrater@gmail.com" className="underline">
            hello.mediacrater@gmail.com
          </a>.
        </p>
        <p className="mt-4">
          We will action all valid deletion requests within a reasonable timeframe.
          We reserve the right to decline requests that are manifestly unfounded,
          repetitive, or made in bad faith, in accordance with applicable data
          protection law.
        </p>
      </section>
      <section className="mb-10">
        <h2 className="text-xl font-semibold mb-3">Cookies and Local Storage</h2>
        <p>
          Our Chrome extension uses only essential local storage required for authentication and
          session management, via Chrome's secure storage API — no advertising, tracking, or
          analytical cookies. Our web app uses a small number of cookies described in our{' '}
          <a href="https://mediacrater.com/cookie-policy" className="underline">
            Cookie Policy
          </a>
          , including a required device cookie used to enforce the free plan, and one optional
          affiliate-tracking cookie that only activates if you accept it.
        </p>
      </section>
      <section className="mb-10">
        <h2 className="text-xl font-semibold mb-3">Changes to This Policy</h2>
        <p>
          If we make material changes to this policy, we will update the effective date above
          and, where appropriate, notify you by email. Continued use of Mediacrater after
          changes constitutes acceptance of the updated policy.
        </p>
      </section>
      <section>
        <h2 className="text-xl font-semibold mb-3">Contact</h2>
        <p>
          Questions about this policy? Email us at{' '}
          <a href="mailto:hello.mediacrater@gmail.com" className="underline">
            hello.mediacrater@gmail.com
          </a>.
        </p>
      </section>
    </main>
  )
}
