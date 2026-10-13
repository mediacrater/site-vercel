//app/tools/break-even-roas-calculator/page.tsx
import type { Metadata } from "next"
import { getTool } from "@/lib/tools/registry"
import { ToolPageShell } from "@/components/tools/tool-page-shell"
import { RoasCalculator } from "./tool"

const tool = getTool("break-even-roas-calculator")

export const metadata: Metadata = {
  title: tool.title,
  description: tool.description,
  alternates: { canonical: `/tools/${tool.slug}` },
  openGraph: {
    title: tool.title,
    description: tool.description,
    url: `/tools/${tool.slug}`,
    type: "website",
  },
}

export default function Page() {
  return (
    <ToolPageShell
      tool={tool}
      intro="Find the ROAS, cost per purchase and cost per click your ads need to break even or hit a profit target. Enter your per-order numbers and the results update as you type."
      method={
        <>
          <p>
            The calculator starts from your <strong>contribution margin</strong>: what's left of one order after
            product cost, shipping, payment fees and refunds, but before ads. Ad spend has to come out of that margin.
          </p>
          <p>
            <strong>Break-even ROAS = 1 ÷ contribution margin %.</strong> With a 50% margin, every $1 of ads must bring
            in $2 of revenue just to break even, so break-even ROAS is 2.0x.
          </p>
          <p>
            <strong>Break-even CPA = contribution margin per order.</strong> If you keep $30 per order before ads, paying
            more than $30 in ads per purchase loses money.
          </p>
          <p>
            <strong>Target ROAS = 1 ÷ (margin % − target profit %).</strong> To keep 10% profit on a 50% margin, ads can
            use 40% of revenue, so target ROAS is 2.5x.
          </p>
          <p>
            <strong>Max CPC = CPA × conversion rate.</strong> At a 2% conversion rate you need about 50 clicks per sale,
            so each click can cost at most 1/50 of your CPA.
          </p>
          <p>
            A common mistake is using gross margin (price minus product cost only). That ignores shipping, fees and
            refunds, and makes break-even ROAS look lower than it really is.
          </p>
        </>
      }
      limits={[
        "Uses averages. Real orders vary in size, cost and refund rate.",
        "Platform-reported ROAS depends on attribution settings and often differs from what your store records.",
        "Fixed costs (salaries, software, rent) are not included. Cover them with your target profit %.",
        "Doesn't account for repeat purchases. Lifetime value can justify a lower first-order ROAS.",
      ]}
      faqs={[
        {
          q: "What is a good ROAS for ecommerce?",
          a: "There's no universal number. A good ROAS is one above your own break-even ROAS, which depends entirely on your margins. A 3x ROAS is profitable at a 50% margin and loses money at a 25% margin.",
        },
        {
          q: "What's the difference between ROAS and break-even ROAS?",
          a: "ROAS is what your ads actually return (revenue ÷ ad spend). Break-even ROAS is the minimum they need to return so you don't lose money. Compare the two to see whether a campaign is profitable.",
        },
        {
          q: "Should I include shipping I charge customers in the order value?",
          a: "Be consistent. If your order value includes shipping charged to the customer, enter your full shipping cost. If it excludes it, enter only the shipping cost you absorb.",
        },
        {
          q: "Does this calculator store my numbers?",
          a: "No. Everything is calculated in your browser and nothing is sent or saved. Refreshing the page resets it.",
        },
      ]}
    >
      <RoasCalculator />
    </ToolPageShell>
  )
}
