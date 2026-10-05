// app/chrome-extension-privacy/page.tsx

import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Chrome Extension Privacy Policy | Mediacrater',
  description:
    'How the Mediacrater Chrome extension handles account data, Facebook Ads Library images and videos, local storage, downloads, and optional policy scans.',
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
          Mediacrater provides a Chrome extension that lets users select, preview, download,
          organize, and optionally scan image and video advertisements found in the Facebook Ads Library.
          We are operated as Mediacrater and can be reached at{' '}
          <a href="mailto:hello.mediacrater@gmail.com" className="underline">
            hello.mediacrater@gmail.com
          </a>.
        </p>
        <p>
          This policy applies specifically to the Mediacrater Chrome extension. Our web app is
          also governed by the main Mediacrater{' '}
          <a href="/privacy" className="underline">
            Privacy Policy
          </a>.
        </p>
      </section>

      <section className="mb-10">
        <h2 className="text-xl font-semibold mb-3">What Data the Extension Handles</h2>
        <p className="mb-4">
          The extension handles only the information needed to provide its user-facing features.
          Some information is stored locally in your browser, while account, billing, and
          user-requested scan information is transmitted to Mediacrater service providers.
        </p>

        <h3 className="text-lg font-semibold mb-2">Account and authentication data</h3>
        <ul className="list-disc list-inside space-y-2 mb-6">
          <li>
            <strong>Email address and user ID</strong> — used to authenticate you, associate the
            extension with your Mediacrater account, and retrieve your plan and feature access.
            Stored and processed through Supabase.
          </li>
          <li>
            <strong>Password</strong> — transmitted directly to Supabase when you sign in. Supabase
            processes and protects your password through its authentication system. Mediacrater
            cannot view your password in plain text.
          </li>
          <li>
            <strong>Authentication tokens</strong> — session and refresh tokens are stored in
            Chrome extension local storage to keep you signed in. They are transmitted to
            Supabase and Mediacrater services only when required to authenticate an account
            request. They are removed from extension storage when you sign out.
          </li>
          <li>
            <strong>Plan and account information</strong> — your plan name, remaining scan balance,
            audio-analysis availability, batch-download access, local-library access, and Stripe
            customer status may be retrieved to display and enforce the features included with
            your account.
          </li>
          <li>
            <strong>Extension version</strong> — the installed extension version is associated with
            your user ID in Supabase so we can manage compatibility, entitlement changes, and
            support issues. The last reported version is also stored locally to prevent redundant
            reports.
          </li>
        </ul>

        <h3 className="text-lg font-semibold mb-2">Facebook Ads Library content</h3>
        <ul className="list-disc list-inside space-y-2 mb-6">
          <li>
            <strong>Visible creative information</strong> — when you activate selection mode on a
            Facebook Ads Library page, the extension examines visible image and video elements so
            you can select a specific advertisement. It may access an image source URL, video
            source URL, video poster URL, the visible numeric Facebook Library ID, and the
            corresponding public Ads Library details URL made available to your browser by Facebook.
          </li>
          <li>
            <strong>Selected-creative records</strong> — the creative type, source URL, optional
            poster URL, Facebook Library ID and details URL when available, creative position,
            selection time, URL refresh time, and a randomly generated local record ID are stored in Chrome extension
            local storage so your selections remain available in the side panel until you remove
            or clear them.
          </li>
          <li>
            <strong>Page access limitations</strong> — the selector operates only on Facebook Ads
            Library pages. The extension does not read Facebook messages, account credentials,
            private posts, or general browsing history.
          </li>
        </ul>

        <h3 className="text-lg font-semibold mb-2">Downloads and previews</h3>
        <ul className="list-disc list-inside space-y-2 mb-6">
          <li>
            <strong>Image and video downloads</strong> — when you click Download, the selected
            source URL is passed to Chrome's download manager and the file is saved to your device.
            For a paid batch download, the extension fetches the selected files in your browser and
            creates a local ZIP containing separate Images and Videos folders. Mediacrater does not
            receive or retain an ordinary download merely because you downloaded it.
          </li>
          <li>
            <strong>Creative previews</strong> — previews load the selected image or video from its
            source URL directly into the extension interface. Previewing does not upload the file
            to Mediacrater.
          </li>
          <li>
            <strong>Ad details and URL refresh</strong> — when you choose Ad details or Refresh URL,
            the extension opens the public Facebook Ads Library page identified by the saved
            Facebook Library ID. A refresh examines the matching ad card after it loads and updates
            the locally stored temporary image or video source URL and poster URL. This operation
            communicates directly with Facebook in your browser and does not upload the creative
            to Mediacrater.
          </li>
        </ul>

        <h3 className="text-lg font-semibold mb-2">Local creative library</h3>
        <p className="mb-4">
          If your plan includes the local creative library, the following information is stored
          on your device using the browser's IndexedDB storage:
        </p>
        <ul className="list-disc list-inside space-y-2 mb-6">
          <li>The saved image or video file and its locally generated low-resolution thumbnail</li>
          <li>The source URL, source host, poster URL, Facebook Library ID and details URL when available, URL refresh time, file type, file size, and saved date</li>
          <li>The title, folder assignment, folder colour, tags, notes, and favourite status</li>
          <li>Your Mediacrater user ID, used locally to separate libraries between signed-in users</li>
        </ul>
        <p className="mb-6">
          Local-library files and organizational information are not uploaded to Mediacrater
          merely because you save or organize them. They remain on the device where they were
          saved unless you explicitly choose to scan a creative. Folder ZIP exports and bulk
          folder assignments are also performed locally in your browser.
        </p>

        <h3 className="text-lg font-semibold mb-2">Extension settings and technical data</h3>
        <ul className="list-disc list-inside space-y-2 mb-6">
          <li>
            <strong>Extension settings</strong> — your selector shortcut, theme preference,
            selector state, and selected-creative list are stored locally so the extension functions
            as configured.
          </li>
          <li>
            <strong>Browser identifier</strong> — the extension generates a random identifier and
            stores it locally. It is not used to monitor your activity on other websites.
          </li>
          <li>
            <strong>Security and request information</strong> — our infrastructure providers may
            process standard technical information such as IP address, User-Agent, timestamps,
            request headers, and security signals when you authenticate, manage billing, or run a
            scan. This information is used to deliver and protect the service.
          </li>
        </ul>

        <h3 className="text-lg font-semibold mb-2">Optional policy scans</h3>
        <ul className="list-disc list-inside space-y-2">
          <li>
            <strong>Scan content</strong> — an image or video is submitted for analysis only when
            you click Scan. For an image scan, the selected image data is transmitted securely to
            Mediacrater for analysis. For a video scan, the extension loads the selected video in
            your browser, extracts representative video frames, and may extract its audio track if
            audio analysis is enabled for your account. The extracted frames and optional audio are
            transmitted securely to Mediacrater. The extension does not transmit the complete
            original video file as part of this video scan workflow.
          </li>
          <li>
            <strong>Scan metadata</strong> — we may process and store your user ID, plan, selected
            platform, scan type, generated scan and queue identifiers, file name, timestamps,
            processing duration, payload size, scan status, token usage, and returned results.
            This information is used to provide scan results, manage queues and balances, display
            scan history where available, diagnose technical problems, and evaluate support or
            refund requests.
          </li>
          <li>
            <strong>AI processing</strong> — selected image data or extracted video frames,
            optional audio, and related text instructions are sent to third-party AI model
            providers solely to perform the scan.
            These providers may process data in countries other than your own and may retain it
            according to their own terms and legal obligations. They do not receive ordinary
            downloaded or locally organized creatives unless you explicitly submit the creative
            for a scan.
          </li>
        </ul>
      </section>

      <section className="mb-10">
        <h2 className="text-xl font-semibold mb-3">Payment Data</h2>
        <ul className="list-disc list-inside space-y-2">
          <li>
            <strong>Checkout and billing portal</strong> — when you choose to purchase or manage a
            plan, the extension requests a secure Stripe checkout or billing-portal session and
            opens the Stripe-hosted page in your browser.
          </li>
          <li>
            <strong>Credit card and billing information</strong> — payment details are collected
            and processed exclusively by Stripe. Mediacrater does not receive or store your full
            card number or security code.
          </li>
          <li>
            <strong>Purchase and subscription records</strong> — we store information needed to
            identify your subscription, apply your plan and scan balance, provide billing support,
            and comply with tax and accounting obligations. Records required for Canadian tax and
            accounting compliance may be retained for six years from the end of the applicable tax
            year, including after account deletion.
          </li>
        </ul>
      </section>

      <section className="mb-10">
        <h2 className="text-xl font-semibold mb-3">How We Use Extension Data</h2>
        <ul className="list-disc list-inside space-y-2">
          <li>To authenticate you and maintain your extension session</li>
          <li>To display your plan, scan balance, and available extension features</li>
          <li>To let you select, preview, copy, refresh, and download Ads Library image and video URLs</li>
          <li>To let you reopen the public Ads Library entry associated with a saved creative</li>
          <li>To provide the on-device creative library and organization tools</li>
          <li>To process policy scans that you explicitly request</li>
          <li>To manage scan queues, token usage, subscriptions, and billing</li>
          <li>To maintain compatibility and diagnose technical or support issues</li>
          <li>To prevent fraud, abuse, and unauthorized access to the service</li>
        </ul>
      </section>

      <section className="mb-10">
        <h2 className="text-xl font-semibold mb-3">Data We Do Not Sell or Use for Advertising</h2>
        <p>
          We do not sell or rent extension user data. We do not use Facebook Ads Library content,
          downloaded images or videos, locally saved library content, authentication information, or scan
          content for targeted advertising, credit decisions, or purposes unrelated to the
          extension's disclosed features.
        </p>
      </section>

      <section className="mb-10">
        <h2 className="text-xl font-semibold mb-3">Data Sharing and Third-Party Services</h2>
        <p className="mb-4">
          We disclose data only to the service providers needed to deliver the requested feature,
          protect the service, process payments, or comply with law.
        </p>
        <ul className="list-disc list-inside space-y-2">
          <li>
            <strong>Supabase</strong> — authentication, account information, plan entitlements,
            extension-version records, scan records, and related database services.
          </li>
          <li>
            <strong>Stripe</strong> — checkout, subscription management, billing, and payment
            processing.
          </li>
          <li>
            <strong>Cloud and server infrastructure providers</strong> — hosting and processing
            account, queue, scan, and security requests.
          </li>
          <li>
            <strong>Cloudflare</strong> — network security, bot protection, traffic management, and
            related security challenges. Cloudflare may process technical signals including IP
            address, User-Agent, and TLS or network information.
          </li>
          <li>
            <strong>AI model providers</strong> — processing selected image data, extracted video
            frames, optional audio, and scan instructions when you explicitly request a policy scan.
          </li>
          <li>
            <strong>Google Chrome</strong> — browser APIs used for local storage, IndexedDB,
            downloads, tab access, scripting, and the extension side panel.
          </li>
          <li>
            <strong>Meta and its content-delivery services</strong> — your browser communicates
            directly with Facebook and fbcdn.net to display, preview, refresh source links for,
            download, and reopen Ads Library images, videos, and ad details that are already
            available in your browser session.
          </li>
        </ul>
        <p className="mt-4">
          Each provider maintains its own privacy policy and security standards. We may also
          disclose information where required by law or where reasonably necessary to protect the
          rights, safety, and security of users, Mediacrater, or the public.
        </p>
      </section>

      <section className="mb-10">
        <h2 className="text-xl font-semibold mb-3">Chrome Extension Permissions</h2>
        <ul className="list-disc list-inside space-y-2">
          <li>
            <strong>activeTab</strong> — verifies that the active page is the Facebook Ads Library
            and communicates with that page when you activate the selector.
          </li>
          <li>
            <strong>downloads</strong> — saves images, videos, and locally generated ZIP archives
            selected by you through Chrome's download manager.
          </li>
          <li>
            <strong>scripting</strong> — loads the selector script and styles into the active Ads
            Library page when required.
          </li>
          <li>
            <strong>storage and unlimitedStorage</strong> — stores authentication sessions,
            settings, selected-creative information, and paid local-library images, videos, and
            metadata on your device.
          </li>
          <li>
            <strong>sidePanel</strong> — displays the Mediacrater interface in Chrome's side panel.
          </li>
          <li>
            <strong>Host access</strong> — limited to Mediacrater services, Facebook Ads Library
            pages, and Facebook content-delivery domains needed to identify, reopen, preview,
            refresh source links for, download, and scan user-selected images and videos.
          </li>
        </ul>
      </section>

      <section className="mb-10">
        <h2 className="text-xl font-semibold mb-3">Data Retention and Deletion</h2>
        <ul className="list-disc list-inside space-y-2">
          <li>
            <strong>Selected-creative records</strong> — remain in extension local storage until you
            remove them, clear the selection, clear extension data, or uninstall the extension.
          </li>
          <li>
            <strong>Local creative library</strong> — images, videos, thumbnails, folders, tags, notes, and
            related metadata remain in IndexedDB until you delete them, clear extension storage,
            or uninstall the extension. Signing out does not automatically erase the local
            library.
          </li>
          <li>
            <strong>Authentication tokens</strong> — retained locally until they expire, are
            invalidated, or you sign out.
          </li>
          <li>
            <strong>Account, entitlement, and extension-version information</strong> — retained
            while your account remains active and as needed to operate and secure the service.
          </li>
          <li>
            <strong>Scan metadata and results</strong> — retained with your account as needed to
            provide scan history, diagnostics, security, balance accounting, and support.
          </li>
          <li>
            <strong>Extracted scan media</strong> — used to complete the requested analysis and not
            intentionally retained by Mediacrater after processing is complete. AI and
            infrastructure providers may retain information according to their own policies and
            legal obligations.
          </li>
          <li>
            <strong>Legally required records</strong> — billing, transaction, fraud-prevention, and
            other records may be retained where required by tax, accounting, security, or other
            applicable law.
          </li>
        </ul>
        <p className="mt-4">
          You may request deletion of your Mediacrater account and associated server-side data by
          emailing us. Local extension data must be deleted through the extension where controls
          are available, by clearing the extension's site data in Chrome, or by uninstalling the
          extension.
        </p>
      </section>

      <section className="mb-10">
        <h2 className="text-xl font-semibold mb-3">Security</h2>
        <p>
          We use HTTPS and modern encrypted connections when the extension communicates with
          Supabase, Mediacrater services, Stripe, and supported third-party providers. No method of
          transmission or storage is completely secure, but we use administrative, technical, and
          organizational safeguards appropriate to the information processed.
        </p>
      </section>

      <section className="mb-10">
        <h2 className="text-xl font-semibold mb-3">Your Choices and Rights</h2>
        <p className="mb-4">You may:</p>
        <ul className="list-disc list-inside space-y-2">
          <li>Remove individual selected images or videos or clear the current selection</li>
          <li>Delete locally saved images, videos, folders, tags, notes, and favourites</li>
          <li>Choose whether to submit any selected creative for a policy scan</li>
          <li>Sign out to remove locally stored authentication tokens</li>
          <li>Clear extension storage or uninstall the extension to remove local extension data</li>
          <li>Request access to, correction of, or deletion of eligible server-side personal data</li>
          <li>Withdraw consent by discontinuing use of the extension and closing your account</li>
          <li>Lodge a complaint with your applicable privacy or data-protection authority</li>
        </ul>
        <p className="mt-4">
          To exercise a privacy right concerning server-side information, email us at{' '}
          <a href="mailto:hello.mediacrater@gmail.com" className="underline">
            hello.mediacrater@gmail.com
          </a>.
        </p>
      </section>

      <section className="mb-10">
        <h2 className="text-xl font-semibold mb-3">Chrome Web Store Limited Use</h2>
        <p>
          Mediacrater's use of information received from Google APIs will adhere to the Chrome Web
          Store User Data Policy, including the Limited Use requirements.
        </p>
      </section>

      <section className="mb-10">
        <h2 className="text-xl font-semibold mb-3">Changes to This Policy</h2>
        <p>
          If we materially change how the extension handles user data, we will update this policy's
          effective date and provide any additional notice or consent required by applicable law or
          Chrome Web Store policy. Continued use after an effective policy change constitutes
          acceptance where permitted by law.
        </p>
      </section>

      <section className="mb-10">
        <h2 className="text-xl font-semibold mb-3">Relationship With Meta</h2>
        <p>
          Mediacrater is not affiliated with, endorsed by, or sponsored by Meta Platforms, Inc.
          Facebook and Meta are trademarks of Meta Platforms, Inc. Users are responsible for
          ensuring they have permission to download, store, and use advertising content.
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
