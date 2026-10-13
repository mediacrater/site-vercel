//app/tools/facebook-ad-rejected-no-reason/page.tsx
import type { Metadata } from "next"
import { getTool } from "@/lib/tools/registry"
import { ToolPageShell } from "@/components/tools/tool-page-shell"
import { RejectionTriage } from "./tool"

const tool = getTool("facebook-ad-rejected-no-reason")

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
      intro="Facebook or Instagram rejected your ad and didn't say why? Tick what's in your ad, and this tool shows which Meta advertising policies it most likely falls under, what to check, and where to read the official rule."
      method={
        <>
          <p>
            I built Mediacrater after running dropshipping ads and losing thousands to rejections and bans that came
            with no clear explanation. This page is the checklist I wish I'd had: the parts of an ad that most often
            fall under Meta's policies, grouped so you can work out where to look first.
          </p>
          <p>
            Each item you tick is linked to one or more areas of Meta's Advertising Standards. The areas with the
            most matches are shown first, each with what to check and a link to the official policy.
          </p>
          <p>
            Meta reviews more than the text fields. Review covers images and video, including on-screen text and
            what's said in the voiceover, plus the landing page your ad links to. Ads can also be reviewed again after
            approval, so an ad that ran fine for days can still be rejected later.
          </p>
          <p>
            <strong>What not to do:</strong> duplicating the rejected ad and relaunching it unchanged usually gets
            the same result, and repeated violations can lead to restrictions on your ad account. Change the likely
            cause first.
          </p>
        </>
      }
      limits={[
        "This narrows down likely causes. It can't tell you which one Meta actually flagged.",
        "It only knows what you tick. It doesn't look at your actual ad, video or landing page.",
        "Meta's policies change. Always confirm on the official policy page before you relaunch.",
        "Policies and requirements vary by country, and some categories need permission from Meta before you can advertise at all.",
      ]}
      faqs={[
        {
          q: "Why did Facebook reject my ad without giving a reason?",
          a: "Meta reviews ads with a mix of automated systems and people, and a rejection notice doesn't point to the specific word, frame or image that caused it. Often it gives no usable reason at all, which is why it helps to check each part of the ad systematically.",
        },
        {
          q: "Where can I request a review of a rejected ad?",
          a: "Meta says you can request a review of a rejected ad in Account Quality. Only do this if you're confident the ad complies, because resubmitting a violating ad won't change the outcome.",
        },
        {
          q: "Can I just duplicate the ad and relaunch it?",
          a: "Relaunching the same content usually gets rejected again, and repeated violations can put your ad account at risk. Fix the likely cause first, then launch the changed version.",
        },
        {
          q: "Why was my ad rejected after it was already running?",
          a: "Ads can be reviewed again at any time, for example after you edit them or after people hide or report them. The ad is judged against the same policies again.",
        },
        {
          q: "Does this tool store or send what I tick?",
          a: "No. Everything runs in your browser and nothing is saved or sent. Refreshing the page clears it.",
        },
      ]}
    >
      <RejectionTriage />
    </ToolPageShell>
  )
}
