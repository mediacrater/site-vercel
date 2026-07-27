import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Refund Policy | Mediacrater',
  description: 'Mediacrater refund policy. Unused tokens refundable within 7 days of purchase. Used tokens are non-refundable.',
  robots: { index: true, follow: true },
}

export default function RefundPolicy() {
  return (
    <main className="max-w-3xl mx-auto px-6 py-16 text-base leading-relaxed">
      <h1 className="text-3xl font-bold mb-2">Refund Policy</h1>
      <p className="text-sm text-muted-foreground mb-10">Effective date: April 2026</p>

      <section className="mb-10">
        <h2 className="text-xl font-semibold mb-3">Our Policy, Simply Put</h2>
        <p>
          Used tokens are non-refundable. If you have unused tokens and haven't gotten the value you
          expected, we'll refund you — minus a flat 10% processing fee to cover unrecoverable
          payment transaction costs.
        </p>
      </section>

      <section className="mb-10">
        <h2 className="text-xl font-semibold mb-3">Eligibility</h2>
        <p className="mb-4">To qualify for a refund, all of the following must be true:</p>
        <ul className="list-disc list-inside space-y-2">
          <li>Your refund request is submitted within <strong>3 days of your purchase date</strong></li>
          <li>Your account has <strong>unused tokens remaining</strong></li>
          <li>You are requesting a refund of <strong>all remaining unused tokens</strong> — we do not issue partial refunds on individual tokens</li>
        </ul>
      </section>

      <section className="mb-10">
        <h2 className="text-xl font-semibold mb-3">What Gets Deducted</h2>
        <p>
          A flat <strong>10% processing fee</strong> is deducted from the refund amount to cover
          unrecoverable payment processing costs charged by our payment provider. This fee applies
          regardless of how many tokens remain.
        </p>
        <div className="mt-4 p-4 rounded-lg bg-muted text-sm">
          <p className="font-medium mb-1">Example</p>
          <p>
            You purchase the Starter plan for $19. You use 3 tokens and have 7 remaining.
            The value of unused tokens is prorated based on your original token cost.
            A 10% fee is deducted from your refund amount.
          </p>
        </div>
      </section>

      <section className="mb-10">
        <h2 className="text-xl font-semibold mb-3">Non-Refundable</h2>
        <ul className="list-disc list-inside space-y-2">
          <li>Tokens that have already been used for scans</li>
          <li>Purchases where the 3-day window has passed</li>
          <li>Individual tokens (refunds apply to the full unused balance only)</li>
        </ul>
      </section>

      <section className="mb-10">
        <h2 className="text-xl font-semibold mb-3">How to Request a Refund</h2>
        <p>
          Email us at{' '}
          <a href="mailto:hello.mediacrater@gmail.com" className="underline">
            hello.mediacrater@gmail.com
          </a>{' '}
          with the subject line <strong>"Refund Request"</strong> and include the email address
          associated with your account and your reason for requesting a refund. We aim to respond
          within 2 business days.
        </p>
      </section>

      <section>
        <h2 className="text-xl font-semibold mb-3">Questions?</h2>
        <p>
          Email us at{' '}
          <a href="mailto:hello.mediacrater@gmail.com" className="underline">
            hello.mediacrater@gmail.com
          </a>{' '}
          and we'll sort it out.
        </p>
      </section>
    </main>
  )
}
