export const metadata = {
  title: 'Changelog – Mediacrater',
  description: 'See what is new in each version of Mediacrater.',
};

export default function ChangelogPage() {
  return (
    <main className="max-w-2xl mx-auto px-6 py-16">
      {}
      <h1 className="text-3xl font-bold mb-2">Changelog</h1>
      <p className="text-muted-foreground mb-12">
        Everything we&apos;ve added to Mediacrater so far.
      </p>
      
      {/* Single container for all sections */}
      <div className="space-y-12">

        {/* V2 Section */}
        <section>
          <div className="flex items-center gap-3 mb-6">
            <h2 className="text-xl font-semibold">Alpha 2.0 to 2.1</h2>
            <span className="text-xs text-muted-foreground">October 2026</span>
          </div>
          
            <section>
              <div className="mb-1">
                <h3 className="text-lg font-semibold">Alpha 2.1</h3>
              </div>
              <ul className="space-y-2 text-sm text-muted-foreground list-disc list-inside">
                <li>No more account login required: All extension features unlocked at no cost to the client</li>

              </ul>
            </section>
          
            <section>
              <div className="mb-1">
                <h3 className="text-lg font-semibold">Alpha 2.0</h3>
              </div>
              <ul className="space-y-2 text-sm text-muted-foreground list-disc list-inside">
                <li>Pivot to a more local and useful extension. Checking ads now happens on the webapp.</li>
                <li>NEW: Download videos from Meta Ads Library</li>
                <li>NEW: Batch ZIP exports organized into dedicated Images and Videos subdirectories</li>
                <li>NEW: Built-in local creative library backed by browser-based IndexedDB storage</li>
                <li>NEW: Custom folders with hex color coding, notes, tags, and favorites</li>
                <li>NEW: Bulk folder exports to ZIP and multi-file folder transfers</li>
                <li>NEW: Reopen saved ads via Facebook Ad ID and refresh expired CDN media URLs</li>
                <li>NEW: Configurable selector hotkey (A–Z) and Chrome Side Panel support</li>
              </ul>
            </section>
        </section>
        
        {/* Alpha Section */}
        <section>
          <div className="flex items-center gap-3 mb-6">
            <h2 className="text-xl font-semibold">Alpha 1.6.3 to 1.6.3.1</h2>
            <span className="text-xs text-muted-foreground">September 2026</span>
          </div>
          
            <section>
              <div className="mb-1">
                <h3 className="text-lg font-semibold">Alpha 1.6.3.1</h3>
              </div>
              <ul className="space-y-2 text-sm text-muted-foreground list-disc list-inside">
                <li>Configuration enhancements</li>

              </ul>
            </section>
          
            <section>
              <div className="mb-1">
                <h3 className="text-lg font-semibold">Alpha 1.6.3</h3>
              </div>
              <ul className="space-y-2 text-sm text-muted-foreground list-disc list-inside">
                <li>Security enhancements</li>

              </ul>
            </section>
        </section>
        
        {/* Alpha Section */}
        <section>
          <div className="flex items-center gap-3 mb-6">
            <h2 className="text-xl font-semibold">Alpha 1.5.7 to 1.6.2</h2>
            <span className="text-xs text-muted-foreground">August 2026</span>
          </div>

          <div className="space-y-4">
            {/* Version 1.6.2 */}
            <section>
              <div className="mb-1">
                <h3 className="text-lg font-semibold">Alpha 1.6.2</h3>
              </div>
              <ul className="space-y-2 text-sm text-muted-foreground list-disc list-inside">
                <li>Extension logs version that the user is on</li>
                <li>Audio analysis now available for paid users</li>

              </ul>
            </section>
            
            {/* Version 1.6.1.1 */}
            <section>
              <div className="mb-1">
                <h3 className="text-lg font-semibold">Alpha 1.6.1.1</h3>
              </div>
              <ul className="space-y-2 text-sm text-muted-foreground list-disc list-inside">
                <li>Updated extension manifest</li>
                <li>Updated extension configuration</li>
              </ul>
            </section>
          
            {/* Version 1.6 */}
            <section>
              <div className="mb-1">
                <h3 className="text-lg font-semibold">Alpha 1.6</h3>
              </div>
              <ul className="space-y-2 text-sm text-muted-foreground list-disc list-inside">
                <li>Web application available</li>
                <li>Collection of uploaded images and a snapshot of the beginning of videos for a centralized history system to paid users across the web app and the extension</li>
              </ul>
            </section>

          
            {/* Version 1.5.8 */}
            <section>
              <div className="mb-1">
                <h3 className="text-lg font-semibold">Alpha 1.5.8</h3>
              </div>
              <ul className="space-y-2 text-sm text-muted-foreground list-disc list-inside">
                <li>Frontend and backend improvements for the abuse prevention measures</li>
              </ul>
            </section>

            {/* Version 1.5.7 */}
            <section>
              <div className="mb-1">
                <h3 className="text-lg font-semibold">Alpha 1.5.7</h3>
              </div>
              <ul className="space-y-2 text-sm text-muted-foreground list-disc list-inside">
                <li>Changed Read and write access to Mediacrater domains instead of Supabase</li>
              </ul>
            </section>
          </div>
        </section>

        {}
        {/* Alpha Section */}
        <section>
          <div className="flex items-center gap-3 mb-6">
            <h2 className="text-xl font-semibold">Alpha 1.5 to 1.5.6</h2>
            <span className="text-xs text-muted-foreground">July 2026</span>
          </div>

          <div className="space-y-4">
            {/* Version 1.5.6 */}
            <section>
              <div className="mb-1">
                <h3 className="text-lg font-semibold">Alpha 1.5.6</h3>
              </div>
              <ul className="space-y-2 text-sm text-muted-foreground list-disc list-inside">
                <li>Security enhancements (automated abuse prevention)</li>
              </ul>
            </section>

            {/* Version 1.5.5 */}
            <section>
              <div className="mb-1">
                <h3 className="text-lg font-semibold">Alpha 1.5.5</h3>
              </div>
              <ul className="space-y-2 text-sm text-muted-foreground list-disc list-inside">
                <li>Fixed issue with token display reaching zero</li>
              </ul>
            </section>

            {/* Version 1.5.4 */}
            <section>
              <div className="mb-1">
                <h3 className="text-lg font-semibold">Alpha 1.5.4</h3>
              </div>
              <ul className="space-y-2 text-sm text-muted-foreground list-disc list-inside">
                <li>
                  Token checks reduced to what is only necessary: down to a strategic 3 poll burst after each scan instead of every 2 seconds
                </li>
              </ul>
            </section>

            {}
            {/* Version 1.5.3 */}
            <section>
              <div className="mb-1">
                <h3 className="text-lg font-semibold">Alpha 1.5.3</h3>
              </div>
              <ul className="space-y-2 text-sm text-muted-foreground list-disc list-inside">
                <li>Allowing bigger file sizes up to 1GB from our previous 700MB limit.</li>
              </ul>
            </section>

            {/* Version 1.5.2 */}
            <section>
              <div className="mb-1">
                <h3 className="text-lg font-semibold">Alpha 1.5.2</h3>
              </div>
              <ul className="space-y-2 text-sm text-muted-foreground list-disc list-inside">
                <li>Fixed error with resend verification email</li>
                <li>Fixed issue where the A keybind reveals scan history for free users</li>
                <li>Fixed UI issue with Deep Scan</li>
                <li>Code improvements</li>
              </ul>
            </section>

            {/* Version 1.5.1 */}
            <section>
              <div className="mb-1">
                <h3 className="text-lg font-semibold">Alpha 1.5.1</h3>
              </div>
              <ul className="space-y-2 text-sm text-muted-foreground list-disc list-inside">
                <li>Added advanced error logging for debugging</li>
                <li>Security enhancements</li>
                <li>Fixed issue with audio analysis answers</li>
                <li>Fixed issue with billing and subscription system</li>
                <li>Added facebook link permission for future feature</li>
                <li>Removed Windows permission (Requests browser access uncessesarily)</li>
                <li>Added resend verification email</li>
              </ul>
            </section>

            {/* Version 1.5 */}
            <section>
              <div className="mb-1">
                <h3 className="text-lg font-semibold">Alpha 1.5</h3>
              </div>
              <ul className="space-y-2 text-sm text-muted-foreground list-disc list-inside">
                <li>Added keyboard shortcuts (W / A / S / D) for panel navigation</li>
                <li>Fixed header disappearing when switching from History to Settings</li>
                <li>Scan history no longer opens a new tab</li>
                <li>Abuse prevention measures added</li>
                <li>Queueing system added</li>
              </ul>
            </section>
          </div>
        </section>

        {}
        {/* Beta Section */}
        <section>
          <div className="flex items-center gap-3 mb-4">
            <h2 className="text-xl font-semibold">Beta 1.1.0</h2>
            <span className="text-xs text-muted-foreground">May 2026</span>
          </div>
          <ul className="space-y-2 text-sm text-muted-foreground list-disc list-inside">
            <li>Added Scan History page</li>
            <li>Subscription plans instead of one time purchases</li>
            <li>UI improvements</li>
            <li>Bug fixes</li>
            <li>Contact support and rate us links in the settings page for easy access</li>
            <li>Email verification now required</li>
          </ul>
        </section>
      </div>
    </main>
  );
}
