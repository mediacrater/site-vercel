'use client'

import { Check, Minus } from 'lucide-react'

const SITE_SIGNUP = process.env.NEXT_PUBLIC_SITE_SIGNUP ?? '#'

const plans = [
  {
    name: 'Free',
    price: '$0',
    period: '/mo',
    scans: '3 scans / mo',
    campaigns: '1 campaign / mo',
    description: 'Get started with no commitment',
    cta: 'Get started',
    popular: false,
  },
  {
    name: 'Startup',
    price: '$10',
    period: '/mo',
    scans: '20 scans / mo',
    campaigns: '3–6 campaigns / mo',
    description: 'For solo dropshippers testing creatives',
    cta: 'Get Startup',
    popular: false,
  },
  {
    name: 'Established',
    price: '$40',
    period: '/mo',
    scans: '100 scans / mo',
    campaigns: '20 to 30+ campaigns / mo',
    description: 'For brands running consistent paid campaigns',
    cta: 'Get Established',
    popular: false,
  },
  {
    name: 'Scaler',
    price: '$80',
    period: '/mo',
    scans: '250 scans / mo',
    campaigns: '50 to 80+ campaigns / mo',
    description: 'For media buyers scaling across multiple offers',
    cta: 'Get Scaler',
    popular: false,
  },
  {
    name: 'Agency',
    price: '$200',
    period: '/mo',
    scans: '1000 scans / mo',
    campaigns: '200 to 300+ campaigns / mo',
    description: 'For agencies managing multiple client accounts',
    cta: 'Get Agency',
    popular: false,
  },
]

type CellValue = boolean | string

const featureRows: { label: string; sub?: string; values: CellValue[] }[] = [
  {
    label: 'Video & image scanning',
    values: [true, true, true, true, true],
  },
  {
    label: 'All platforms supported',
    values: [true, true, true, true, true],
  },
  {
    label: 'Violation timestamps & fixes',
    values: [true, true, true, true, true],
  },
  {
    label: 'Scan type',
    values: ['Regular', 'Regular + Deep', 'Regular + Deep', 'Regular + Deep', 'Regular + Deep'],
  },
  {
    label: 'Monthly scans',
    values: ['3', '20', '100', '250', '1000'],
  },
  {
    label: 'Campaigns / month',
    values: ['1', '3–6', '20–33', '50–83', '200-300+'],
  },
  {
    label: 'Priority processing',
    values: [false, true, true, true, true],
  },
  {
    label: 'Scan history',
    values: [false, true, true, true, true],
  },
  {
    label: 'Audio analysis',
    values: [false, true, true, true, true],
  },
]

function Cell({ value }: { value: CellValue }) {
  if (typeof value === 'boolean') {
    return value ? (
      <Check className="w-4 h-4 mx-auto text-emerald-500" strokeWidth={2.5} />
    ) : (
      <Minus className="w-4 h-4 mx-auto text-muted-foreground/30" strokeWidth={2} />
    )
  }
  return (
    <span className="text-sm font-medium text-foreground">
      {value}
    </span>
  )
}

// How many plan columns come before the popular one (0-indexed)
const popularIndex = plans.findIndex((p) => p.popular)

export function Pricing() {
  return (
    <section id="pricing" className="py-20 md:py-32 bg-secondary/30">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">

        {/* Header */}
        <div className="text-center max-w-2xl mx-auto mb-16">
          <h2 className="text-3xl sm:text-4xl font-bold text-foreground font-[family-name:var(--font-display)] text-balance">
            Simple, Transparent Pricing
          </h2>
          <p className="mt-4 text-lg text-muted-foreground text-pretty">
            Pick a plan based on how many campaigns you run per month.
            Cancel or change anytime. Extension users: Subscriptions are 
            upgradable and managed through the{' '}
            <a
              href={SITE_SIGNUP}
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-foreground transition-colors"
            >
              Chrome extension
            </a>
          </p>
        </div>

        <div className="relative pt-5">

          {/* Most popular badge — positioned above the popular column header */}
          <div
            className="absolute top-0 left-0 right-0 pointer-events-none"
            aria-hidden="true"
          >
            {/* We use a flex row that mirrors the table column widths to place the badge */}
            <div className="flex min-w-[700px]">
              {/* Feature label column: w-[220px] */}
              <div className="w-[220px] shrink-0" />
              {plans.map((plan) => (
                <div key={plan.name} className="flex-1 flex justify-center">
                  {plan.popular && (
                    <span className="bg-accent text-accent-foreground text-[10px] font-bold px-3 py-1 rounded-full whitespace-nowrap uppercase tracking-wider">
                      Most popular
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Pricing table */}
          <div className="rounded-2xl border border-border shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[700px] border-collapse">

                {/* Plan headers */}
                <thead>
                  <tr>
                    {/* Feature label column */}
                    <th className="w-[220px] bg-card px-6 pt-8 pb-5 text-left align-bottom border-r border-border">
                      <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                        Features
                      </span>
                    </th>

                    {plans.map((plan) => (
                      <th
                        key={plan.name}
                        className={`px-4 pt-8 pb-5 text-center align-bottom border-r last:border-r-0 border-border ${
                          plan.popular ? 'bg-primary' : 'bg-card'
                        }`}
                      >
                        <div className={`text-xs font-bold uppercase tracking-widest mb-1 ${
                          plan.popular ? 'text-primary-foreground/70' : 'text-muted-foreground'
                        }`}>
                          {plan.name}
                        </div>
                        <div className="flex items-baseline justify-center gap-0.5 mb-3">
                          <span className={`text-2xl font-bold ${
                            plan.popular ? 'text-primary-foreground' : 'text-foreground'
                          }`}>
                            {plan.price}
                          </span>
                          <span className={`text-xs ${
                            plan.popular ? 'text-primary-foreground/60' : 'text-muted-foreground'
                          }`}>
                            {plan.period}
                          </span>
                        </div>
                        <p className={`text-[11px] leading-relaxed mb-2.5 ${
                          plan.popular ? 'text-primary-foreground/60' : 'text-muted-foreground'
                        }`}>
                          {plan.description}
                        </p>
                        <a
                          href={SITE_SIGNUP}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={`block w-full text-center py-2 rounded-lg text-xs font-semibold transition-opacity hover:opacity-90 ${
                            plan.popular
                              ? 'bg-accent text-accent-foreground'
                              : 'bg-primary/10 text-primary hover:bg-primary/15 border border-primary/20'
                          }`}
                        >
                          {plan.cta}
                        </a>
                      </th>
                    ))}
                  </tr>
                </thead>

                {/* Feature rows */}
                <tbody>
                  {featureRows.map((row, rowIdx) => (
                    <tr
                      key={row.label}
                      className={rowIdx % 2 === 0 ? 'bg-card' : 'bg-secondary/40'}
                    >
                      {/* Feature label */}
                      <td className="px-6 py-4 border-r border-border">
                        <span className="text-sm text-foreground/80 font-medium">{row.label}</span>
                        {row.sub && (
                          <p className="text-xs text-muted-foreground mt-0.5">{row.sub}</p>
                        )}
                      </td>

                      {plans.map((plan, planIdx) => (
                        <td
                          key={plan.name}
                          className={`px-4 py-4 text-center border-r last:border-r-0 border-border ${
                            plan.popular ? 'bg-primary/5' : ''
                          }`}
                        >
                          <Cell value={row.values[planIdx]} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>

              </table>
            </div>
          </div>
        </div>

        {/* Trust line */}
        <p className="text-center text-sm text-muted-foreground mt-10 flex items-center justify-center gap-2 flex-wrap">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="w-4 h-4"
          >
            <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
          Secure checkout via Stripe
          <span className="text-border">·</span>
          Cancel anytime
          <span className="text-border">·</span>
          No hidden fees
        </p>

      </div>
    </section>
  )
}
