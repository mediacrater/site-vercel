// app/chrome-extension-privacy/page.tsx

import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Chrome Extension Privacy Policy | Mediacrater',
  description:
    'How the Mediacrater Chrome extension handles local data, Facebook Ads Library images and videos, local IndexedDB storage, downloads, and optional policy scans.',
  robots: { index: true, follow: true },
}

export default function ExtensionPrivacyPolicy() {
  return (
    <main className="max-w-3xl mx-auto px-6 py-16 text-base leading-relaxed">
      <h1 className="text-3xl font-bold mb-2">Chrome Extension Privacy Policy</h1>
      <p className="text-sm text-muted-foreground mb-10">
        Effective date: September 30, 2026
      </p>

      <section className="mb-10">
        <h2 className="text-xl font-semibold mb-3">Who We Are</h2>
        <p className="mb-4">
          Mediacrater provides a Chrome extension that lets users select, preview, download, and
          organize ad media content found in the Facebook Ads Library.
          We can be reached at{' '}
          <a href="mailto:hello.mediacrater@gmail.com" className="underline">
            hello.mediacrater@gmail.com
          </a>.
        </p>
        <p>
          This policy applies specifically to the Mediacrater Chrome extension. Our web app is
          governed by the main Mediacrater{' '}
          <a href="/privacy" className="underline">
            Privacy Policy
          </a>.
        </p>
      </section>

      <section className="mb-10">
        <h2 className="text-xl font-semibold mb-3">What Data the Extension Handles</h2>
        <p className="mb-4">
          By default, the Mediacrater extension operates locally on your machine. We do not require account creation or user sign-in to use the extension.
        </p>

        <h3 className="text-lg font-semibold mb-2">Facebook Ads Library content</h3>
        <ul className="list-disc list-inside space-y-2 mb-6">
          <li>
            <strong>Visible creative information</strong> — when you activate selection mode on a
            Facebook Ads Library page, the extension examines visible image and video elements so
            you can select a specific advertisement. It accesses image source URLs, video source URLs, poster URLs, visible numeric Facebook Library IDs, and public Ads Library detail URLs.
          </li>
          <li>
            <strong>Selected-creative records</strong> — creative type, source URL, poster URL, Facebook Library ID, selection time, and a local record ID are stored in Chrome extension local storage so your selections remain available in your side panel.
          </li>
          <li>
            <strong>Page access limitations</strong> — the selector operates strictly on Facebook Ads Library pages. The extension does not read messages, private posts, account credentials, or general browsing history.
          </li>
        </ul>

        <h3 className="text-lg font-semibold mb-2">Downloads and previews</h3>
        <ul className="list-disc list-inside space-y-2 mb-6">
          <li>
            <strong>Image and video downloads</strong> — when downloading single files or batch ZIP archives, media files are fetched directly within your browser context and saved to your device via Chrome’s download manager.
          </li>
          <li>
            <strong>Creative previews and link refreshing</strong> — previewing media and refreshing expired Facebook CDN URLs operates directly between your browser and Facebook’s public servers.
          </li>
        </ul>

        <h3 className="text-lg font-semibold mb-2">Local creative library</h3>
        <p className="mb-4">
          Saved images, videos, low-resolution thumbnails, folder structures, hex colors, tags, notes, and favorites are stored entirely on your device using browser IndexedDB storage.
        </p>

        <h3 className="text-lg font-semibold mb-2">Optional Policy Scanning</h3>
        <p className="mb-6">
          If you explicitly choose to run an advertising policy risk scan on a selected creative, the creative URL and associated text data are transmitted to Mediacrater’s scanning API strictly to analyze policy risks and return scan results.
        </p>

        <h3 className="text-lg font-semibold mb-2">Extension settings and technical data</h3>
        <ul className="list-disc list-inside space-y-2 mb-6">
          <li>
            <strong>Extension settings</strong> — your preferred activation key shortcut (A–Z), theme preferences, and current UI state are saved locally.
          </li>
          <li>
            <strong>Security and request information</strong> — standard technical metadata (IP address, User-Agent, request headers) may be processed by our infrastructure providers only when you interact with server-side endpoints like policy scans.
          </li>
        </ul>
      </section>

      <section className="mb-10">
        <h2 className="text-xl font-semibold mb-3">How We Use Extension Data</h2>
        <ul className="list-disc list-inside space-y-2">
          <li>To display selected ad creatives in your browser side panel.</li>
          <li>To package batch downloads and manage your local offline swipe file.</li>
          <li>To process ad policy compliance checks when explicitly requested by you.</li>
        </ul>
      </section>

      <section className="mb-10">
        <h2 className="text-xl font-semibold mb-3">Data We Do Not Sell or Use for Advertising</h2>
        <p>
          We do not sell, rent, or trade user data. Locally saved library content and downloaded media are never used for targeted advertising, tracking, or profiling.
        </p>
      </section>

      <section className="mb-10">
        <h2 className="text-xl font-semibold mb-3">Chrome Extension Permissions</h2>
        <ul className="list-disc list-inside space-y-2">
          <li>
            <strong>activeTab</strong> — detects when you are viewing the Facebook Ads Library and communicates with the page when activating selection mode.
          </li>
          <li>
            <strong>downloads</strong> — saves images, videos, and locally constructed ZIP archives to your computer.
          </li>
          <li>
            <strong>scripting</strong> — injects the element selector interface into the active Ads Library page.
          </li>
          <li>
            <strong>storage and unlimitedStorage</strong> — stores your extension preferences, selected ads, and local IndexedDB creative library on your device.
          </li>
          <li>
            <strong>sidePanel</strong> — renders the Mediacrater interface inside Chrome’s native side panel.
          </li>
        </ul>
      </section>

      <section className="mb-10">
        <h2 className="text-xl font-semibold mb-3">Data Retention and Deletion</h2>
        <p className="mb-4">
          All selected ads, custom folders, tags, notes, and local library media remain in your browser storage (IndexedDB & Chrome Local Storage) until you manually delete them inside the extension, clear your browser storage, or uninstall the extension.
        </p>
      </section>

      <section className="mb-10">
        <h2 className="text-xl font-semibold mb-3">Your Choices and Rights</h2>
        <p className="mb-4">You can:</p>
        <ul className="list-disc list-inside space-y-2">
          <li>Remove individual saved ads or clear your local creative library at any time.</li>
          <li>Choose whether or not to submit any selected ad creative for a policy risk scan.</li>
          <li>Completely erase all local data by uninstalling the extension or clearing extension site data in Chrome settings.</li>
        </ul>
      </section>

      <section className="mb-10">
        <h2 className="text-xl font-semibold mb-3">Chrome Web Store Limited Use</h2>
        <p>
          Mediacrater’s use of information received from Google APIs adheres to the Chrome Web Store User Data Policy, including the Limited Use requirements.
        </p>
      </section>

      <section className="mb-10">
        <h2 className="text-xl font-semibold mb-3">Changes to This Policy</h2>
        <p>
          If we materially change how the extension handles user data, we will update this policy’s effective date. Continued use of the extension after an updated effective date indicates acceptance of the revised policy.
        </p>
      </section>

      <section className="mb-10">
        <h2 className="text-xl font-semibold mb-3">Relationship With Meta</h2>
        <p>
          Mediacrater is not affiliated with, endorsed by, or sponsored by Meta Platforms, Inc. Facebook and Meta are trademarks of Meta Platforms, Inc.
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
