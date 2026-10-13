//app/tools/break-even-roas-calculator/tool.tsx
"use client"

import { useMemo, useState } from "react"

// ---------------------------------------------------------------------------
// MATH (pure function: no React, easy to check by hand)
//
// Contribution margin (CM) = what's left of one order after every variable cost
// except ads:
//   CM per order = price − product cost − shipping − payment fees − refunds
//   CM %         = CM per order ÷ price
//
//   Break-even ROAS = 1 ÷ CM %             (ad spend eats the whole margin)
//   Break-even CPA  = CM per order          (max you can pay per sale and not lose money)
//   Target ROAS     = 1 ÷ (CM % − target profit %)
//   Target CPA      = price × (CM % − target profit %)
//   Max CPC         = CPA × conversion rate (clicks needed per sale)
// ---------------------------------------------------------------------------

export interface CalcInput {
  price: number // average order value
  productCost: number // cost of goods per order
  shipping: number // shipping + packaging per order
  feePct: number // payment processor %, e.g. 2.9
  feeFixed: number // payment processor fixed fee, e.g. 0.30
  refundPct: number // % of revenue lost to refunds
  targetProfitPct: number // profit % you want left after ads
  conversionPct: number // % of clicks that buy
}

export interface CalcResult {
  cmPerOrder: number
  cmPct: number
  breakEvenRoas: number | null
  breakEvenCpa: number | null
  breakEvenCpc: number | null
  targetRoas: number | null
  targetCpa: number | null
  targetCpc: number | null
  problem: string | null
}

export function calculate(i: CalcInput): CalcResult {
  const fees = i.price * (i.feePct / 100) + i.feeFixed
  const refunds = i.price * (i.refundPct / 100)
  const cmPerOrder = i.price - i.productCost - i.shipping - fees - refunds
  const cmPct = i.price > 0 ? cmPerOrder / i.price : 0
  const cvr = i.conversionPct / 100
  const targetShare = cmPct - i.targetProfitPct / 100

  const empty: CalcResult = {
    cmPerOrder, cmPct,
    breakEvenRoas: null, breakEvenCpa: null, breakEvenCpc: null,
    targetRoas: null, targetCpa: null, targetCpc: null,
    problem: null,
  }

  if (i.price <= 0) return { ...empty, problem: "Enter an average order value above 0." }
  if (cmPerOrder <= 0) {
    return { ...empty, problem: "Your costs are higher than your price, so every sale loses money before ads. No ROAS can break even." }
  }

  const breakEvenCpa = cmPerOrder
  const result: CalcResult = {
    ...empty,
    breakEvenRoas: 1 / cmPct,
    breakEvenCpa,
    breakEvenCpc: cvr > 0 ? breakEvenCpa * cvr : null,
  }

  if (targetShare <= 0) {
    return { ...result, problem: "Your target profit is higher than your margin before ads, so it can't be reached with any ad spend." }
  }

  const targetCpa = i.price * targetShare
  return {
    ...result,
    targetRoas: 1 / targetShare,
    targetCpa,
    targetCpc: cvr > 0 ? targetCpa * cvr : null,
  }
}

// ---------------------------------------------------------------------------
// INPUT HANDLING
// Inputs are kept as text so the field can be empty while typing.
// Commas are accepted as decimals (e.g. "2,9" in Europe).
// ---------------------------------------------------------------------------

type Field = keyof CalcInput

const FIELDS: { key: Field; label: string; hint: string; kind: "money" | "pct"; max?: number }[] = [
  { key: "price", label: "Average order value", hint: "What a customer pays per order", kind: "money" },
  { key: "productCost", label: "Product cost per order", hint: "Cost of goods (COGS)", kind: "money" },
  { key: "shipping", label: "Shipping & packaging per order", hint: "What you pay, not what you charge", kind: "money" },
  { key: "feePct", label: "Payment fee %", hint: "e.g. 2.9 for Stripe/Shopify Payments", kind: "pct", max: 100 },
  { key: "feeFixed", label: "Payment fee per order", hint: "e.g. 0.30", kind: "money" },
  { key: "refundPct", label: "Refunds (% of revenue)", hint: "Revenue you give back", kind: "pct", max: 100 },
  { key: "targetProfitPct", label: "Target profit % after ads", hint: "Use 0 to only see break-even", kind: "pct", max: 100 },
  { key: "conversionPct", label: "Conversion rate %", hint: "Purchases ÷ link clicks, for max CPC", kind: "pct", max: 100 },
]

const DEFAULTS: Record<Field, string> = {
  price: "60", productCost: "18", shipping: "6", feePct: "2.9", feeFixed: "0.30",
  refundPct: "3", targetProfitPct: "10", conversionPct: "2",
}

const CURRENCIES = ["USD", "EUR", "GBP", "CAD", "AUD"] as const

/** Turns user text into a safe number: empty/invalid → 0, negatives → 0, % capped. */
function toNumber(raw: string, max?: number): number {
  const n = Number(raw.replace(",", ".").trim())
  if (!Number.isFinite(n) || n < 0) return 0
  return max !== undefined ? Math.min(n, max) : n
}

export function RoasCalculator() {
  const [values, setValues] = useState<Record<Field, string>>(DEFAULTS)
  const [currency, setCurrency] = useState<(typeof CURRENCIES)[number]>("USD")

  const money = useMemo(
    () => new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 2 }),
    [currency]
  )
  const fmtMoney = (n: number | null) => (n === null ? "—" : money.format(n))
  const fmtRoas = (n: number | null) => (n === null ? "—" : `${n.toFixed(2)}x`)

  const result = useMemo(() => {
    const input = Object.fromEntries(
      FIELDS.map((f) => [f.key, toNumber(values[f.key], f.max)])
    ) as unknown as CalcInput
    return calculate(input)
  }, [values])

  return (
    <div className="rounded-xl border border-border bg-card p-4 sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-semibold">Your numbers (per order)</p>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          Currency
          <select
            value={currency}
            onChange={(e) => setCurrency(e.target.value as (typeof CURRENCIES)[number])}
            className="rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground"
          >
            {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        {FIELDS.map((f) => (
          <div key={f.key}>
            <label htmlFor={f.key} className="block text-sm font-medium">
              {f.label}{f.kind === "pct" ? " (%)" : ""}
            </label>
            <input
              id={f.key}
              type="text"
              inputMode="decimal"
              autoComplete="off"
              value={values[f.key]}
              onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
              className="mt-1.5 h-11 w-full rounded-md border border-border bg-background px-3 text-base outline-none focus:border-primary"
            />
            <p className="mt-1 text-xs text-muted-foreground">{f.hint}</p>
          </div>
        ))}
      </div>

      <div aria-live="polite" className="mt-6 border-t border-border pt-6">
        <p className="text-sm text-muted-foreground">
          Margin before ads: <span className="font-semibold text-foreground">{fmtMoney(result.cmPerOrder)}</span> per order
          ({(result.cmPct * 100).toFixed(1)}%)
        </p>

        {result.problem && (
          <p className="mt-3 rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm">{result.problem}</p>
        )}

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <ResultCard
            title="Break-even (no profit, no loss)"
            rows={[
              ["ROAS", fmtRoas(result.breakEvenRoas)],
              ["Max cost per purchase (CPA)", fmtMoney(result.breakEvenCpa)],
              ["Max cost per click (CPC)", fmtMoney(result.breakEvenCpc)],
            ]}
          />
          <ResultCard
            title={`Target (${toNumber(values.targetProfitPct, 100)}% profit after ads)`}
            rows={[
              ["ROAS", fmtRoas(result.targetRoas)],
              ["Max cost per purchase (CPA)", fmtMoney(result.targetCpa)],
              ["Max cost per click (CPC)", fmtMoney(result.targetCpc)],
            ]}
          />
        </div>
      </div>
    </div>
  )
}

function ResultCard({ title, rows }: { title: string; rows: [string, string][] }) {
  return (
    <div className="rounded-lg border border-border bg-background p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</p>
      <dl className="mt-3 space-y-2">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-baseline justify-between gap-3">
            <dt className="text-sm text-muted-foreground">{label}</dt>
            <dd className="font-mono text-lg font-semibold">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}
