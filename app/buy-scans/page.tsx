'use client';

// app/buy-scans/page.tsx
//
// The web app's own checkout entry point — deliberately a different
// route/name from /buy-tokens (which stays as-is for the extension) so
// it's obvious at a glance, in analytics and in the URL bar, which
// surface a given checkout came from.
//
// Unlike /buy-tokens, this page is authenticated: identity comes from
// the signed-in Supabase session (same as the rest of the dashboard),
// never from a URL parameter. There's no "open this from the right
// place or the buttons stay disabled" state here — being signed in IS
// the gate, enforced server-side by create-checkout-webapp itself

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Header } from '@/components/header';
import { Check, Minus } from 'lucide-react';
import { supabase } from '@/lib/mediacrater/supabaseClient';

const PLANS = [
  {
    id: 'startup',
    name: 'Startup',
    price: '$10',
    period: '/mo',
    scans: 20,
    description: 'For solo dropshippers testing new creatives',
  },
  {
    id: 'established',
    name: 'Established',
    price: '$40',
    period: '/mo',
    scans: 100,
    description: 'For brands running consistent paid campaigns',
  },
  {
    id: 'scaler',
    name: 'Scaler',
    price: '$80',
    period: '/mo',
    scans: 250,
    description: 'For media buyers scaling across multiple offers',
  },
  {
    id: 'agency',
    name: 'Agency',
    price: '$200',
    period: '/mo',
    scans: 1000,
    description: 'For agencies managing multiple client accounts',
  },
];

type CellValue = boolean | string;

const featureRows: { label: string; values: CellValue[] }[] = [
  { label: 'Video & image scanning', values: [true, true, true, true] },
  { label: 'All platforms supported', values: [true, true, true, true] },
  { label: 'Violation timestamps & fixes', values: [true, true, true, true] },
  { label: 'Scan type', values: ['Regular + Deep', 'Regular + Deep', 'Regular + Deep', 'Regular + Deep'] },
  { label: 'Monthly scans', values: ['20', '100', '250', '1000'] },
  { label: 'Priority support', values: [true, true, true, true] },
  { label: 'Audio analysis', values: [true, true, true, true] },
];

const FAQ_ITEMS = [
  {
    question: 'What counts as one scan?',
    answer:
      'One scan = one ad analyzed against one platform. A video or image submitted for Meta compliance check uses 1 scan regardless of length or file size.',
  },
  {
    question: 'What happens to my scans if I upgrade mid-cycle?',
    answer:
      "Your scan count resets immediately to your new plan's full allocation on the day you upgrade. Your billing cycle also resets from that day.",
  },
  {
    question: 'What happens if I downgrade or cancel?',
    answer:
      'You keep your current plan and scan count until the end of your billing cycle. After that, your scan count resets to the new plan (or the free plan, if cancelled).',
  },
  {
    question: 'Is my payment secure?',
    answer: 'Yes. All payments are processed by Stripe. We never store or see your card details.',
  },
];

function Cell({ value }: { value: CellValue }) {
  if (typeof value === 'boolean') {
    return value ? (
      <Check className="w-4 h-4 mx-auto text-emerald-500" strokeWidth={2.5} />
    ) : (
      <Minus className="w-4 h-4 mx-auto text-muted-foreground/30" strokeWidth={2} />
    );
  }
  return <span className="text-sm font-medium text-foreground">{value}</span>;
}

function FAQItem({ question, answer }: { question: string; answer: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-border last:border-0">
      <button onClick={() => setOpen(!open)} className="w-full flex justify-between items-center py-4 text-left gap-4">
        <span className="font-medium text-sm">{question}</span>
        <span className="text-muted-foreground text-lg flex-shrink-0">{open ? '−' : '+'}</span>
      </button>
      {open && <p className="text-sm text-muted-foreground pb-4 leading-relaxed">{answer}</p>}
    </div>
  );
}

export default function BuyScansPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [currentPlan, setCurrentPlan] = useState<string>('free');
  const [loadingPlan, setLoadingPlan] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const init = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        router.push('/signin');
        return;
      }
      const { data: profile } = await supabase.from('profiles').select('plan').eq('id', session.user.id).single();
      setCurrentPlan(profile?.plan || 'free');
      setLoading(false);
    };
    init();
  }, [router]);

  const handleSubscribe = async (planId: string) => {
    setError(null);
    setLoadingPlan(planId);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        router.push('/signin');
        return;
      }

      const response = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/create-checkout-webapp`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ plan: planId }),
        }
      );

      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to start checkout');
      window.location.href = data.url;
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
      setLoadingPlan(null);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p className="text-muted-foreground font-medium">Loading...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Header />
      <main className="max-w-6xl mx-auto px-4 pt-32 pb-16 space-y-14">
        <div className="text-center space-y-3 max-w-2xl mx-auto">
          <h1 className="text-3xl font-bold">Choose your plan</h1>
          <p className="text-muted-foreground text-sm">
            Pick a plan based on how many ad campaigns you run per month. Change or cancel anytime.
          </p>
        </div>

        {error && (
          <div className="max-w-md mx-auto p-3 rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 text-sm text-red-800 dark:text-red-400 text-center">
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {PLANS.map((plan) => {
            const isCurrent = plan.id === currentPlan;
            return (
              <div
                key={plan.id}
                className={`rounded-xl border p-5 flex flex-col ${
                  isCurrent ? 'border-primary bg-primary/5' : 'border-border bg-card'
                }`}
              >
                <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground mb-1">{plan.name}</p>
                <div className="flex items-baseline gap-1 mb-2">
                  <span className="text-2xl font-bold">{plan.price}</span>
                  <span className="text-xs text-muted-foreground">{plan.period}</span>
                </div>
                <p className="text-xs text-muted-foreground mb-4">{plan.description}</p>
                <p className="text-xs font-semibold mb-4">{plan.scans} scans / month</p>
                <button
                  onClick={() => handleSubscribe(plan.id)}
                  disabled={isCurrent || loadingPlan !== null}
                  className={`mt-auto w-full py-2 rounded-lg text-xs font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                    isCurrent
                      ? 'bg-muted text-muted-foreground border border-border'
                      : 'bg-primary text-primary-foreground hover:bg-primary/90'
                  }`}
                >
                  {isCurrent ? 'Current Plan' : loadingPlan === plan.id ? 'Redirecting…' : `Get ${plan.name}`}
                </button>
              </div>
            );
          })}
        </div>

        <div className="rounded-2xl border border-border shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[600px] border-collapse text-sm">
              <thead>
                <tr className="bg-card">
                  <th className="px-6 py-3 text-left border-r border-b border-border">
                    <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                      Features
                    </span>
                  </th>
                  {PLANS.map((plan) => (
                    <th key={plan.id} className="px-4 py-3 text-center border-r last:border-r-0 border-b border-border">
                      <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                        {plan.name}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {featureRows.map((row, rowIdx) => (
                  <tr key={row.label} className={rowIdx % 2 === 0 ? 'bg-card' : 'bg-secondary/40'}>
                    <td className="px-6 py-3 border-r border-border">
                      <span className="text-foreground/80 font-medium">{row.label}</span>
                    </td>
                    {PLANS.map((plan, planIdx) => (
                      <td key={plan.id} className="px-4 py-3 text-center border-r last:border-r-0 border-border">
                        <Cell value={row.values[planIdx]} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <p className="text-center text-xs text-muted-foreground flex items-center justify-center gap-2 flex-wrap">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="w-3 h-3">
            <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
          Secure checkout via Stripe
          <span className="text-border">·</span>
          Cancel anytime
          <span className="text-border">·</span>
          No hidden fees
        </p>

        <section className="max-w-2xl mx-auto bg-card border border-border rounded-2xl p-8">
          <h2 className="text-xl font-bold mb-2">Frequently Asked Questions</h2>
          <div className="mt-4">
            {FAQ_ITEMS.map((item, i) => (
              <FAQItem key={i} question={item.question} answer={item.answer} />
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
