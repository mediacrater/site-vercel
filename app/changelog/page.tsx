export const metadata = {
  title: 'Changelog – Mediacrater',
  description: 'See what is new in each version of Mediacrater.',
};

export default function ChangelogPage() {
  return (
    <main className="max-w-2xl mx-auto px-6 py-16">
      <h1 className="text-3xl font-bold mb-2">Changelog</h1>
      <p className="text-muted-foreground mb-12">Everything we've added to Mediacrater so far.</p>

      <div className="space-y-12">
        <section>
          <div className="flex items-center gap-3 mb-4">
            <h2 className="text-xl font-semibold">Alpha 1.5.6</h2>
            <span className="text-xs text-muted-foreground">July 2026</span>
          </div>
          <ul className="space-y-2 text-sm text-muted-foreground list-disc list-inside">
            <li>Fixed error with resend verification email</li>
            <li>Bug fixes/improvements</li>
          </ul>
        </section>
        <section>
          <div className="flex items-center gap-3 mb-4">
            <h2 className="text-xl font-semibold">Alpha 1.5.1</h2>
            <span className="text-xs text-muted-foreground">July 2026</span>
          </div>
          <ul className="space-y-2 text-sm text-muted-foreground list-disc list-inside">
            <li>Added advanced error logging for debugging</li>
            <li>Backend security enhancements</li>
            <li>Fixed issue with audio analysis answers</li>
            <li>Fixed issue with billing and subscription system</li>
            <li>Added facebook link permission for future feature</li>
            <li>Removed Windows permission (Requests browser access uncessesarily)</li>
            <li>Added resend verification email</li>
          </ul>
        </section>
        <section>
          <div className="flex items-center gap-3 mb-4">
            <h2 className="text-xl font-semibold">Alpha 1.5</h2>
            <span className="text-xs text-muted-foreground">July 2026</span>
          </div>
          <ul className="space-y-2 text-sm text-muted-foreground list-disc list-inside">
            <li>Added keyboard shortcuts (W / A / S / D) for panel navigation</li>
            <li>Fixed header disappearing when switching from History to Settings</li>
            <li>Scan history no longer opens a new tab</li>
            <li>Abuse prevention measures added</li>
            <li>Queueing system added</li>
          </ul>
        </section>
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

        {/* Add new entries above this line */}
      </div>
    </main>
  );
}
