import type { Metadata } from 'next'
export const metadata: Metadata = {
  title: 'Cookie Policy | Mediacrater',
  description: 'Cookie Policy for Mediacrater. Learn about the cookies we use and how to manage your choices.',
  robots: { index: true, follow: true },
}
export default function CookiePolicy() {
  return (
    <main className="max-w-3xl mx-auto px-6 py-16 text-base leading-relaxed">
      <h1 className="text-3xl font-bold mb-2">Cookie Policy</h1>
      <p className="text-sm text-muted-foreground mb-6">Last updated: August 2026</p>
      <section className="mb-10">
        <h2 className="text-xl font-semibold mb-3">The short version</h2>
        <p>
          Mediacrater uses cookies to keep you signed in, to keep the free plan fair, and — if you
          come from one of our affiliates and choose to accept — to credit that affiliate. We don't
          use cookies for advertising, we don't sell data, and we don't track you across other
          websites.
        </p>
      </section>
      <section className="mb-10">
        <h2 className="text-xl font-semibold mb-3">Cookies that are always on (required for the site to work)</h2>
        <p className="mb-4">
          These are necessary for core functionality — signing in, staying signed in, keeping
          your account secure, and enforcing the free plan. Because they're required for the
          service to function, they're not subject to the choice below.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm border-collapse mb-4">
            <thead>
              <tr className="border-b border-border">
                <th className="py-2 pr-4 font-semibold">Cookie</th>
                <th className="py-2 px-4 font-semibold">Purpose</th>
                <th className="py-2 pl-4 font-semibold">Duration</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              <tr>
                <td className="py-3 pr-4 align-top">Supabase session cookies</td>
                <td className="py-3 px-4 align-top">Keep you signed in to your account</td>
                <td className="py-3 pl-4 align-top">Until you sign out, or session expiry</td>
              </tr>
              <tr>
                <td className="py-3 pr-4 align-top">Device identifier cookie</td>
                <td className="py-3 px-4 align-top">
                  Identifies this browser so the free plan cannot be reset by opening extra
                  accounts. Not used for ads. Not your login session — it stays after you sign out.
                </td>
                <td className="py-3 pl-4 align-top">13 months</td>
              </tr>
              <tr>
                <td className="py-3 pr-4 align-top font-mono text-xs">
                  <code className="bg-muted px-1.5 py-0.5 rounded">mc_cookie_consent</code>
                </td>
                <td className="py-3 px-4 align-top">
                  Remembers your cookie choice so we don't ask on every page
                </td>
                <td className="py-3 pl-4 align-top">12 months</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
      <section className="mb-10">
        <h2 className="text-xl font-semibold mb-3">Cookies that require your choice</h2>
        <div className="overflow-x-auto mb-4">
          <table className="w-full text-left text-sm border-collapse">
            <thead>
              <tr className="border-b border-border">
                <th className="py-2 pr-4 font-semibold">Cookie</th>
                <th className="py-2 px-4 font-semibold">Purpose</th>
                <th className="py-2 px-4 font-semibold">Duration</th>
                <th className="py-2 pl-4 font-semibold">Third-party?</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              <tr>
                <td className="py-3 pr-4 align-top font-mono text-xs">
                  <code className="bg-muted px-1.5 py-0.5 rounded">mc_referrer</code>
                </td>
                <td className="py-3 px-4 align-top">
                  Records which affiliate you came from, if you arrived via one of their links, so we
                  can credit them if you sign up
                </td>
                <td className="py-3 px-4 align-top">Until you close your browser</td>
                <td className="py-3 pl-4 align-top">No — first-party only, never shared</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p>
          If you decline, this cookie is simply never set. Nothing about the site's functionality
          changes — the only effect is that the affiliate won't get credit for that visit. The
          device cookie above is not part of this choice.
        </p>
      </section>
      <section className="mb-10">
        <h2 className="text-xl font-semibold mb-3">What we don't do</h2>
        <ul className="list-disc list-inside space-y-2">
          <li>We don't use advertising or retargeting cookies.</li>
          <li>We don't use third-party analytics trackers.</li>
          <li>We don't sell or share cookie data with third parties.</li>
          <li>We don't track you across other websites.</li>
        </ul>
      </section>
      <section className="mb-10">
        <h2 className="text-xl font-semibold mb-3">Your choice</h2>
        <p>
          You'll see a short prompt on your first visit asking whether to accept the affiliate-tracking
          cookie described above. You can change your mind at any time by clearing your browser's
          cookies for this site. Clearing cookies will also reset the device cookie, which may look
          like a new device the next time you visit.
        </p>
      </section>
      <section>
        <h2 className="text-xl font-semibold mb-3">Questions</h2>
        <p>
          If you have questions about this policy, contact us at{' '}
          <a href="mailto:hello.mediacrater@gmail.com" className="underline">
            hello.mediacrater@gmail.com
          </a>.
        </p>
      </section>
    </main>
  )
}
