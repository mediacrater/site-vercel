# Mediacrater Change Index

Chronological reference for Mediacrater product, UX, architecture, security, marketing, and operational changes discussed in ChatGPT.

## 1. Homepage direction
- Keep the homepage conversion- and SEO-oriented rather than turning it into a dashboard.
- Preserve the existing pricing box and testimonial screenshot images.
- Current structure: Header, Hero, Social Proof, Features, How It Works, Ad Account Insurance, Pricing, FAQ, CTA, Footer.
- Visual direction: editorial website × video analysis tool × compliance report.
- Avoid generic “vibe-coded” SaaS/dashboard aesthetics.

## 2. Hero positioning
- Headline: **“Know before you launch.”**
- Supporting copy: **“Scan your video ads for potential Meta, TikTok, and Google policy issues before you spend money promoting them.”**
- CTAs: **“Try it free”** and **“See how it works.”**
- Platform references: Meta, TikTok, YouTube, X, Pinterest.
- Supporting badges: Privacy-first processing, Multi-platform support, Audio analysis.

## 3. Hero animation
- Headline transitions from the question-style version to **“Know before you launch.”**
- Uses an inline slide/reveal rather than a flip.
- Shorter “Know” state collapses its width so spacing stays natural.
- Punctuation changes to a period.
- Reduced-motion users receive an opacity-only transition.
- Mobile issue was confirmed to be stale browser cache; incognito testing showed the current implementation was correct.
- Reference file: `hero.tsx`.

## 4. Hero CTA / auth routing decision
- Keep the Hero CTA pointing to `/signup`.
- Do not make the Hero itself responsible for auth detection.
- `/signup` owns the rule that authenticated users should not see signup.
- This also handles direct visits/bookmarks.
- Current Hero defines the URL through `NEXT_PUBLIC_APP_URL` and uses it for “Try it free.” fileciteturn2file0L8-L10 fileciteturn2file0L160-L172

## 5. Auth-aware signup redirect
**File:** `app/signup/page.tsx`

Desired behavior:
- Logged out → render signup form.
- Logged in → immediately redirect to `/dashboard`.
- Do not render the signup form while the session check is pending.

Implementation:
- Import `supabase` from `@/lib/mediacrater/supabaseClient`.
- Add `checkingSession`, initially `true`.
- Call `supabase.auth.getSession()` in `useEffect`.
- If a session exists, call `router.replace("/dashboard")`.
- If no session exists, set `checkingSession` to `false`.
- Return `null` while checking.

Use `replace`, not `push`, so Back does not return an authenticated user to the auth page.

## 6. Auth-aware signin redirect
**File:** `app/signin/page.tsx`

A dedicated signin route exists at `/signin`.

Desired behavior:
- Logged out → render signin form.
- Logged in → immediately redirect to `/dashboard`.
- Do not render the signin form while the session check is pending.

Implementation:
- The page already imports the Supabase client.
- Add `checkingSession`, initially `true`.
- Call `supabase.auth.getSession()` in `useEffect`.
- If a session exists, call `router.replace("/dashboard")`.
- If no session exists, set `checkingSession` to `false`.
- Return `null` while checking.

## 7. Final auth flow
| State | Route | Result |
|---|---|---|
| Logged out | `/signup` | Signup form |
| Logged in | `/signup` | Redirect to `/dashboard` |
| Logged out | `/signin` | Signin form |
| Logged in | `/signin` | Redirect to `/dashboard` |
| Logged out | Hero CTA | `/signup` → signup |
| Logged in | Hero CTA | `/signup` → `/dashboard` |

## 8. Existing signup/auth infrastructure
The existing signup API already handles server-side signup, Supabase authentication, rate limiting, Turnstile, device/account telemetry, and session creation. The new auth-page redirect is a pre-entry UX improvement and does not replace those server-side controls.

## 9. Scan cancellation/accounting boundary
Problem identified: token deduction occurred only after successful results, while a browser could potentially cancel after server processing began.

Decision:
Once a scan is authenticated, authorized, and its allowance is successfully reserved, the server-side job is non-cancellable.

Recommended accounting:
```text
available scans -= 1
reserved scans += 1

success:
reserved scans -= 1

legitimate system failure:
reserved scans -= 1
allowance may be returned according to failure policy
```

Use the scan ID as the source of truth and make consumption idempotent.

## 10. Persistent asynchronous scans
- Server becomes the source of truth for scan state.
- Lifecycle: `queued → processing → completed` or `failed`.
- Useful fields: `status`, `started_at`, `completed_at`, `error_code`, `error_message`.
- Browser navigation/closure must not cancel an accepted server job.
- Dashboard states: spinner = running, green check = completed, red X = failed.
- Cancellation control disappears once the job has been accepted/reserved.

## 11. Batch scanning
Paid-user batch concept:
- Upload approximately 3–5 ads.
- Process sequentially.
- Enforce a 5-second delay between scans.
- No delay after the final scan.
- Optional single completion email after the entire batch.
- Results remain in normal scan history.
- Use shared `batch_id` to identify batch membership.
- Reserve the complete batch allowance before processing.
- Enforce timing server-side/through the queue, not with frontend timers.

## 12. Scan feedback
After each scan:
- **“Did we get this right?”**
- YES / NO.
- If NO, ask **“What did we get wrong?”** and allow a comment.

Planned `scans` fields:
- `feedback_answer BOOLEAN NULL`
- `feedback_comment TEXT NULL`
- `policy_engine_version` for attribution to the exact engine/model version.

## 13. Media improvement consent
Checkbox:
**“I consent to send the media used in this scan to Mediacrater to improve the service”**

- Default unchecked.
- If unchecked, delete media according to the privacy policy.
- If checked, retain it for the explicitly disclosed improvement purpose.

Planned fields:
- `media_improvement_consent BOOLEAN NOT NULL DEFAULT FALSE`
- `media_consent_at TIMESTAMP NULL`

Privacy policy must accurately match actual retention, improvement/training, human-review, and third-party-processing practices.

## 14. Abuse prevention
- Repeated signup activity from the same IP was identified.
- Cloudflare was installed and stopped the bot activity.
- Signup telemetry includes browser/device and ASN/IP intelligence for abuse detection.
- Durable device identifier is used for account/device tracking.
- Telemetry purpose is disclosed in the privacy policy.
- VPS endpoints use user-ID checks and rate limits.

## 15. Security testing
Planned staging pentest using synthetic data and no production secrets.

Scope:
- Auth/authz
- Signup abuse
- Scan/usage-limit enforcement
- API endpoints
- Uploads
- Stored scan results
- Payments/subscription boundaries
- IDOR/BOLA
- Rate limiting/resource exhaustion
- Sessions/tokens
- OWASP issues
- Extension/API authentication

Critical findings should receive a retest.

## 16. Chrome extension direction
The extension may be reduced to a thin **creative capture/hand-off layer** rather than a second Mediacrater application.

Initial workflow:
Facebook Ads Library → select video element → “Scan with Mediacrater” → hand off creative/reference → authenticated persistent web-app scan → VPS analysis → normal dashboard result.

Do not put proprietary policy/risk logic, Qwen logic, token accounting, or core analysis in the extension.

Potential future sources include TikTok Creative Center, YouTube, and other creative repositories/context-menu workflows.

Team seats do not require the extension.

## 17. Team/sub-account architecture
- Owner controls subscription, billing, plan, scan allowance, and team management.
- Subaccounts have their own login and can scan.
- Subaccounts cannot change billing/plan or access owner credentials.
- Scan usage rolls up to the owner.
- Team members see their own history; owner sees team history.
- Seats are delegated access, not independent scan pools.

## 18. Pricing strategy
Current conceptual tiers:
- Free: approximately one campaign/new account per month.
- $10/month: approximately 20 scans / roughly 3–6 campaigns.
- $40/month: approximately 20–33 campaigns.
- Higher tiers: $80 and $200.

Team-seat concept:
- $10: 1 seat
- $40: 1 seat
- $80: 2 seats
- $200: 5 seats
- Possible +20-seat add-on around $20–$25/month
- More than ~20 seats → enterprise/contact sales

Keep the homepage pricing box unchanged unless pricing is deliberately revisited.

## 19. Product positioning
Mediacrater is inexpensive insurance for advertisers:
- Check creative before putting ad spend behind it.
- Surface potential platform-policy issues.
- Reduce avoidable risk.
- Provide guidance, not guaranteed approval.

Do not claim:
- 100% accuracy
- Guaranteed approval
- Algorithm replication
- Ability to override platform decisions

The platform ultimately makes the advertising decision.

## 20. Ad-account insurance messaging
Keep the Insurance component blunt and directed at informed media buyers.

Core idea:
- Insurance is disliked until something goes wrong.
- Ad-account/platform problems can be expensive.
- Platform decisions are opaque.
- Clean advertising history can matter to advertisers.

Do not soften this into generic SaaS copy without a deliberate positioning decision.

## 21. Risk UI
Numerical risk/confidence percentages were removed.

Current UI:
- Low risk
- Medium risk
- High risk

Reason: avoid implying false numerical certainty.

Homepage/demo visuals should not reintroduce confidence percentages.

## 22. AI model strategy
Image scans:
- Qwen 3.7 Flash via QwenCloud.
- Observed usage approximately 5,000–6,000 tokens per image scan.

Video scans:
- Gemini 2.5 Flash Lite remains the current direction because the existing workflow requires audio alongside visual/text inputs.

Store policy/model engine version with scans so feedback can be analyzed by version.

## 23. Qwen provider reliability
OpenRouter Qwen usage showed frequent 429 failures despite available balance.

Observed pattern was roughly 40–50% 429 failures.

Working hypothesis: provider/shared capacity rather than account balance.

QwenCloud was selected as the direct API path for the image workflow.

## 24. Operations / Slack metrics
Planned Slack metrics:
- API costs
- New signups
- Revenue
- Percentage of users who scan again

Windows:
- 24h
- 7d
- 14d
- 30d
- 90d

Repeat-scan metrics should become cohort-based when enough data exists.

## 25. Early activation funnel
Legitimate accounts:
- 56 total
- 31 made at least one scan
- 20 made a second scan
- 8 made a third scan

Approximate funnel:
- Signup → first scan: **55.4%**
- First → second: **64.5%**
- Signup → second: **35.7%**
- Second → third: **40.0%**
- Signup → third: **14.3%**

Interpretation:
- Clearest bottleneck: signup → first scan.
- First → second also drops meaningfully, but cause should be diagnosed rather than assumed.
- Useful metrics: time-to-first-scan, time between scans, scan #2/#3/#5 rates, paid conversion, retention, and feedback versus repeat behavior.

## 26. Auth-aware CTA as activation optimization
A logged-in user was being sent from the homepage “Try for free” CTA to `/signup`.

Resolution:
- Keep the CTA pointing to `/signup`.
- Make `/signup` auth-aware.
- Logged-in user now goes to `/dashboard` rather than seeing redundant signup UI.

This directly reduces friction in the signup → first-scan funnel.

## 27. Creator acquisition strategy
Target:
- Ecommerce creators
- Paid-acquisition/media-buying creators
- Meta/Facebook Ads educators
- TikTok Ads/media buyers
- Performance marketing creators

Secondary:
- Ecommerce scaling/CRO

Lower priority:
- Organic/reel creators

Preferred sponsorship:
1. Creator finishes an ad.
2. Creator says they will check compliance.
3. Runs it through Mediacrater.
4. Shows result.
5. Brief explanation and free-trial/discount information.

Principle: **Demonstrate why you use Mediacrater rather than simply advertising it.**

Measure creator → signup → first scan → second scan → paid → retention.

## 28. Creator testing budget
Potential capital source: sale of an older software business for approximately $3,000 CAD.

Potential allocation:
- ~$1,200 CAD staging pentest.
- ~$1,800 CAD for 2–3 creator promotions.

Treat initial creator campaigns as controlled acquisition tests.

## 29. Change-log convention
For future changes, append a new numbered section rather than rewriting historical decisions.

Recommended format:

```md
## N. Short change title

### Date
YYYY-MM-DD

### Files changed
- `path/to/file`

### Change
What changed.

### Reason
Why it changed.

### Result
Behavior after the change.

### Notes
Implementation details, tradeoffs, or follow-up work.
```

---

## Current immediate task status

### Auth-page redirect
Files:
- `app/signup/page.tsx`
- `app/signin/page.tsx`

Required behavior:
- Authenticated users never see the auth forms.
- Pages check Supabase session before rendering.
- Authenticated users use `router.replace("/dashboard")`.
- Unauthenticated users see the normal form.
- Hero remains unchanged.

### Last inspected file
`hero.tsx` — confirmed that no Hero modification is required for the auth-aware redirect.
