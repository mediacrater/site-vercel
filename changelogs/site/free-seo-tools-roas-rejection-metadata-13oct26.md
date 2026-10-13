# Free SEO Tools: Site SEO Fixes, Tool Framework, ROAS Calculator, Rejection Triage & ExifTool Metadata Remover

| | |
|---|---|
| **Date** | 13 October 2026 (`13oct26`) |
| **Destination** | changelogs/site |
| **Conversation** | _(add this chat's link)_ |
| **Related prior work** | `test-site-basic-auth-noindex-13oct26.md` (same day, companion file: test-site password and noindex)<br>Research report "Mediacrater: 10 Free Web Tools, Keyword Clusters, and an Honest Build Plan" (artifact in this chat) |
| **Stack** | Next.js 16 (App Router, Turbopack) on Vercel, Tailwind, Supabase auth. Test repo `mediacrater/test-site-vercel`. A drift monitor copies files between live and test |
| **Starting trigger** | You wanted free, no-signup tools with instant results, clean mobile UX and one CTA into Mediacrater, to rank in search for keywords with real intent and weak competition |

> **Redaction note:** No keys, passwords, domains of the test site or user data are included. All CTA links are relative paths.

**How to read the status marks in this file:** ✅ = done and you reported or verified it, or I saw it in the test repo. ⚠️ = advised, but I can't confirm it was applied. ⏳ = open. Where something wasn't confirmed, the **expected output** is given so you can check it yourself.

> **Repo state checked:** statuses marked "seen in repo" come from the test repo at commit `eb36cba` (latest when this file was written). **Nothing in this file has been confirmed on live.**

---

## Contents

1. [Summary](#1-summary)
2. [Status at a glance](#2-status-at-a-glance)
3. [Starting point](#3-starting-point)
4. [Timeline: what we did, in order](#4-timeline-what-we-did-in-order)
5. [Errors and surprises](#5-errors-and-surprises)
6. [Corrections / important decisions](#6-corrections--important-decisions)
7. [Open items checklist](#7-open-items-checklist)
8. [Porting to LIVE: step by step](#8-porting-to-live-step-by-step)
9. [Reference: key settings](#9-reference-key-settings)
10. [Appendix A – Site SEO fixes (exact edits)](#appendix-a--site-seo-fixes-exact-edits)
11. [Appendix B – Tool framework files](#appendix-b--tool-framework-files)
12. [Appendix C – ROAS calculator](#appendix-c--roas-calculator)
13. [Appendix D – "Facebook ad rejected with no reason" triage](#appendix-d--facebook-ad-rejected-with-no-reason-triage)
14. [Appendix E – Metadata remover (ExifTool)](#appendix-e--metadata-remover-exiftool)
15. [Appendix F – Verification and troubleshooting commands](#appendix-f--verification-and-troubleshooting-commands)
16. [Appendix G – Rollback and maintenance](#appendix-g--rollback-and-maintenance)

---

## 1. Summary

We built three free tools and a `/tools` hub on the test site, plus a small shared framework so every new tool is two files and one registry line. Before building, we fixed SEO problems in the existing site that would have stopped the tool pages from ranking.

**Main outcomes**

- **Three tools, all `live` in the test registry:**
  1. `/tools/break-even-roas-calculator`: break-even and target ROAS, CPA and CPC from contribution margin, with the formulas shown.
  2. `/tools/facebook-ad-rejected-no-reason`: tick what's in a rejected ad, get the Meta policy areas it most likely falls under. No AI.
  3. `/tools/video-metadata-remover`: shows every metadata field (ExifTool in the browser) and removes all of it that can be removed without re-encoding.
- **Shared framework:** a tool registry, one CTA per page that goes to `/signup?src=<tool>` with UTM tags, structured data (`WebApplication` + `BreadcrumbList`), and a page shell (H1, privacy line, tool, CTA, how it works, limitations, FAQ, related tools).
- **Site SEO fixes:** the root layout set the homepage as canonical for **every** page, so Google would have treated `/about`, `/solutions` and all tool pages as copies of the homepage. Also fixed: `/solutions` had no metadata of its own, the insurance section CTA pointed to the Chrome extension under a "3 free scans" promise (scans are web-app only), and the footer described the old product.
- **Everything runs in the visitor's browser.** No tool uploads files or text.
- **Decisions:** the metadata tool is framed as a **privacy** tool, never as ban evasion. The ad-copy policy checker was dropped (it needs context a phrase list can't judge). Rejection pages are built around "rejected with no reason" rather than one page per policy label, because in your experience Meta never showed a label.

**Not yet done:** porting to live, several small open items ([section 7](#7-open-items-checklist)), keyword validation in Ahrefs or Semrush, and browser tests of the three tools that you haven't reported back on.

---

## 2. Status at a glance

### Site SEO fixes (Phase 3)

| Area | Status | Notes |
|---|---|---|
| Root canonical removed from `app/layout.tsx` | ✅ Done | Seen in repo |
| Homepage canonical `"/"` in `app/page.tsx` | ✅ Done | Seen in repo |
| `/about` canonical | ⏳ Open | The line `alternates: { canonical: '/about' }` sits **inside** `openGraph`, so Next.js ignores it. Move it out ([Appendix A](#appendix-a--site-seo-fixes-exact-edits)) |
| `/solutions` split into server `page.tsx` + `solutions-client.tsx` | ✅ Done | Seen in repo, with canonical `/solutions` |
| Layout description rewritten (no "Stop getting banned.") | ✅ Done | Seen in repo |
| `'ad account ban prevention'` removed from `keywords` | ⏳ Open | Still on line 38 of `app/layout.tsx` |
| Insurance CTA → `/signup?src=home-insurance…` | ✅ Done | Seen in repo |
| Insurance copy | ⚠️ Partly | Title changed. Body still says "Faster approvals, better delivery, more leniency." (unsupported claim) |
| Footer text, `/#features` style anchors, `/tools` link | ✅ Done | Seen in repo |
| `'wasm-unsafe-eval'` in `script-src` | ✅ Done | Needed by the metadata tool. Keep it |
| `public/robots.txt` with disallow lines | ✅ Done | Seen in repo |
| `app/robots.ts` | ⏳ Open | Still exists next to `public/robots.txt`. Delete it (on live too, or the drift monitor brings it back) |
| Root `sitemap.xml` (never served) | ✅ Deleted | Commit `ccfb507` |
| Tool URLs in `public/sitemap.xml` | ⏳ Open | Only 5 URLs. `/tools`, the three tools and `/solutions` are missing |
| eslint installed | ⏳ Open | `"lint": "eslint ."` exists, eslint doesn't |
| `ignoreBuildErrors: true` | Kept | Decision: keep for now, run `npx tsc --noEmit` before pushing tool changes |

### Tool framework

| Area | Status | Notes |
|---|---|---|
| `lib/tools/registry.ts` (3 tools, all `live`) | ✅ Done | Seen in repo. You removed the unused draft entries |
| `lib/tools/cta.ts`, `components/tools/json-ld.tsx` | ✅ Done | Seen in repo |
| `components/tools/tool-page-shell.tsx` | ✅ Done | Seen in repo |
| Shell top padding under the fixed header | ⏳ Open | Shell still has `py-10`, so the top of each tool page sits under the 64 px header. Change to `pt-28 pb-10` |
| `/tools` hub | ✅ Verified | Your screenshot showed the hub with the calculator card. Header overlap fixed with `pt-28` |
| Signup stores `?src=` for attribution | ⚠️ Unknown | I never read `app/signup`. Without it you can't tell which tool produced a signup |

### Tools

| Tool | Status | Notes |
|---|---|---|
| Break-even ROAS calculator | ✅ In repo, `live` | ⚠️ You didn't report the checks. **Expected with default inputs:** break-even ROAS **1.87x**, break-even CPA **$32.16**, target ROAS **2.29x**, target CPA **$26.16** |
| Rejection triage | ✅ In repo, `live` | ⚠️ Checks not reported. 11 of 12 policy links still point to Meta's general Advertising Standards page |
| Metadata remover v2 (ExifTool) | ✅ In repo, `live`, builds on Vercel | The build error was fixed (Phase 13). Later deploys went out, which means the build passed. ⚠️ Browser tests not reported |
| `public/vendor/zeroperl.wasm` in `.gitignore` | ⏳ Open | Not committed today, but nothing stops it being committed by accident (25 MB) |

### Rollout and growth

| Area | Status | Notes |
|---|---|---|
| Any of this on **live** | ⏳ Not started | See [section 8](#8-porting-to-live-step-by-step) |
| Keyword validation (Ahrefs / Semrush / incognito Google) | ⏳ Open | No volume or difficulty numbers exist yet |
| Search Console: sitemap + Request indexing | ⏳ After live | |
| Search Console check at 4 and 8 weeks | ⏳ After live | |
| Chrome Web Store listing still advertises the policy scanner | ⚠️ Advised | Scans are web-app only now |
| Influencer links `/signup?src=inf-<name>` and #ad disclosure | ⚠️ Advised | |

---

## 3. Starting point

- Mediacrater sells video and image ad policy scans in the **web app** (`/signup`, 3 free scans a month). You corrected me early on: the **Chrome extension no longer scans**. It's a free Ads Library downloader used for SEO and as part of the free-tool strategy.
- Gemini had produced two documents: 10 tool ideas with keyword lists, and a research write-up. Its keyword lists included CPC numbers and "Zero competition" labels with no data source, and it pitched the metadata remover as an "un-fingerprinter" to avoid Meta bans.
- You had two ideas of your own: a metadata remover, and a revenue/CPC/ROAS calculator for ecommerce brands on Meta.
- The site is Next.js 16 on Vercel, with a fixed 64 px header, a static `public/sitemap.xml` from xml-sitemaps.com, and a strict CSP built in `next.config.mjs` (report-only by default).

---

## 4. Timeline: what we did, in order

### Phase 1 – Strategy and research

- I flagged problems in the Gemini base before researching:
  - **Ban evasion:** the "un-fingerprinter" framing helps evade Meta enforcement, which Meta's Advertising Standards prohibit. It's also likely ineffective, because Meta matches content visually (PDQ / TMK+PDQF), not by file tags.
  - **Made-up numbers:** the CPC and "Zero competition" figures had no source.
  - **Unsupported claims:** "80% of bans come from visuals" and "CPMs spike 40%" had no source either.
  - **Rankings:** top-5 rankings can't be promised.
- The research report ranked 10 tools. Your two ideas came last: the ROAS calculator for weak fit and a crowded market, the metadata remover for weak fit and needing an honest framing.
- **Spec corrections from the research:** Facebook Feed primary text is 50–150 characters with a 27-character headline (not "125/40 everywhere"), and the Reels safe zone is 14% top, 35% bottom and 6% per side.
- **Your correction:** scans live only in the web app. So every CTA goes to the web app, and the "route mobile users away from the extension" idea was dropped.

### Phase 2 – Repo audit

I read the test repo before planning and found 10 issues. Five of them mattered most:
1. Every page canonicalised to the homepage.
2. `/solutions` was a client page, so it had no metadata of its own.
3. Three sitemaps, all stale or unused.
4. The insurance CTA pointed to the extension under a scan promise.
5. The CSP would block WebAssembly.

The others were: the footer described the old product, the layout description promised "Stop getting banned.", `ignoreBuildErrors: true`, `npm run lint` failing because eslint isn't installed, and the test site being indexable.

### Phase 3 – Site SEO fixes

Edits are in [Appendix A](#appendix-a--site-seo-fixes-exact-edits). Statuses are in [section 2](#2-status-at-a-glance). The test-site noindex part of this phase, and the `Unexpected token 'if'` build error it caused, are in the companion file.

You asked what **not** to apply to live. The answer:
- **Never on live:** the `NOINDEX=true` variable.
- **Only when the first WebAssembly tool ships:** `'wasm-unsafe-eval'`.
- **Only as a set:** deleting the static sitemap and robots files together with adding generated ones, and moving the canonical together with adding the homepage one.

### Phase 4 – robots.txt and sitemap

- You asked why the files should be deleted, since Google asks for `.txt` files. **Answer:** Google only requests the URLs `/robots.txt` and `/sitemap.xml`; how they're produced doesn't matter.
- I conceded that generating `robots.txt` in code gains nothing. **Decision:** keep `public/robots.txt` (now with disallow lines) and the static `public/sitemap.xml`, and add tool URLs by hand.

### Phase 5 – Tool framework

Registry, CTA builder, JSON-LD, page shell and hub ([Appendix B](#appendix-b--tool-framework-files)).

**Simplified pattern for every tool:**
1. `app/tools/<slug>/tool.tsx` (client, interactive)
2. `app/tools/<slug>/page.tsx` (server, SEO)
3. Set `status: "live"` in the registry.

### Phase 6 – "Am I on the right track?"

You said the plan was over-complicated, so I simplified it. I cloned the repo and ran a full production build, and it passed. Three things were left:
1. `/about`'s canonical sat inside `openGraph`. **Still open.**
2. `app/robots.ts` and `public/robots.txt` both existed. I had said this breaks the build; it doesn't. **Still open.**
3. The footer linked to `/tools` while no tool was live. Resolved once the calculator went live.

### Phase 7 – ROAS calculator

- [Appendix C](#appendix-c--roas-calculator). It uses contribution margin (price minus product cost, shipping, payment fees and refunds), not gross margin.
- **Formulas:**
  - break-even ROAS = 1 ÷ CM%
  - break-even CPA = CM per order
  - target ROAS = 1 ÷ (CM% − target profit%)
  - max CPC = CPA × conversion rate
- It guards against costs higher than the price, and against a target profit above the margin.

### Phase 8 – `/tools` showed the 404 page

That was intended: the hub calls `notFound()` while no tool is `live`. Setting the calculator to `live` and redeploying fixed it.

### Phase 9 – Hub content under the header

The header is `fixed` and 64 px high. The homepage hero compensates with `pt-28`, but my hub and shell didn't. You fixed the hub. **The shell is still open.**

### Phase 10 – Which tools stand out

- You wanted tools that are rare but in demand. I searched what currently ranks:
  - **"Can I advertise ___?" lookup:** only static listicles rank, one dated 2021.
  - **Rejection decoder:** only generic "why was my ad rejected" articles rank.
  - **Whole-video safe-zone scan:** existing checkers all check one frame, but demand is unproven.
- You dropped the copy checker because it needs AI reasoning. I agreed: a phrase list can't judge context.
- You said Meta **never** showed you a policy label on any rejection. I noted that some advertisers do see labels (sometimes only in Account Quality), but built for your experience: a "rejected with no reason" page with a triage tool.

### Phase 11 – Rejection triage tool

- [Appendix D](#appendix-d--facebook-ad-rejected-with-no-reason-triage).
- **How it works:** 22 tickable signals in five groups (copy, visuals, product, landing page, ad history), mapped to 12 Meta policy areas and ranked by number of matches. Each area says what to check and links the official policy.
- **What it doesn't claim:** no score and no prediction. It states that this is not a diagnosis.
- The founder paragraph is based on your About page.
- I could only verify Meta's Personal Attributes page URL, so the other areas link to the general Advertising Standards page.

You joked about "pumping out slop". I noted that Google's spam policies target scaled content abuse, so we kept to fewer, useful pages.

### Phase 12 – Metadata remover

**v1 (replaced):** a lossless JavaScript box rewriter with no WebAssembly. Your paste of `lib/tools/metadata-cleaner.ts` was cut off at line 334 (`// MP4 /`), which caused `processVideo is not defined`.

**v2 (current):**
- **Why it changed:** you wanted the thoroughness of metadata2go: see the file details and every field, and remove all of it.
- **The engine:** ExifTool, running in the browser via `@uswriting/exiftool` 1.0.9 (Apache-2.0), on a Perl-in-WebAssembly runtime of about 25 MB (7.7 MB compressed).
- **When it loads:** only the first time a file is picked, so the page itself stays fast.

How v2 works ([Appendix E](#appendix-e--metadata-remover-exiftool)):

| Step | What happens |
|---|---|
| Read | `parseMetadata` with `-json -G1 -a -s` lists every field, grouped. File details (type, size, dimensions, duration, codec, frame rate, bitrate, audio) are built from the result. Privacy-sensitive fields are highlighted |
| Remove | `writeMetadata` with `-all=`. For videos, the six QuickTime header dates are set to `0000:00:00 00:00:00`, because they can't be deleted. For photos, `-tagsFromFile @ -Orientation -ICC_Profile` puts back rotation and colour profile |
| Patch | `blankEncoderFields` zeroes the encoder name and vendor code inside the codec description (fixed-size fields, nothing moves) |
| Verify | The cleaned file is scanned again and shown |

**What can't be removed without re-encoding:** encoder settings inside the compressed video stream, and timed metadata tracks.

**Engine hosting:** the library fetches `./zeroperl.wasm` relative to the page URL, which would 404 on `/tools/...`. So `scripts/copy-exiftool-wasm.mjs` copies the engine to `public/vendor/` on every `npm install`, and the code fetches `/vendor/zeroperl.wasm`. You also excluded `vendor` from the middleware matcher (commit `93d3201`).

**My sandbox tests** of the v2 code: privacy-sensitive fields before → after, on files I created with ffmpeg and Pillow.

| File | Before | After | Other checks |
|---|---|---|---|
| MOV | 24 | 0 | Decodes fully with ffmpeg, video and audio |
| MP4 | 11 | 0 | Decodes fully |
| JPG | 12 | 0 | Orientation 6 kept |
| PNG | 3 | 0 | Orientation kept |
| WebP | 1 | 0 | Orientation kept |

A production build also passed with the new files. **Not tested by me:** a real browser.

### Phase 13 – Vercel build failure

- **The error:** `Error: Cannot find module '@6over3/zeroperl-ts/zeroperl.wasm'` from `postinstall`.
- **Cause:** your pushed `package.json` had the `postinstall` line but not the dependency, and `package-lock.json` didn't mention it.
- **Fix:** you ran `npm install --save-exact @uswriting/exiftool@1.0.9` and pushed both files (commit `e388b88`).

### Phase 14 – Micro-influencers and SEO expectations

- **Influencers:** good for fast traffic, but social links are typically nofollow, so they don't build rankings. Paid posts need a clear disclosure (#ad or the platform's paid-partnership label). No "never get banned" claims. Give each influencer their own `src` link.
- **Your point:** other founders saw tool-driven SEO grow within 1–2 months. My answer: plausible for long-tail terms, with survivorship bias and head starts (domain strength, launch backlinks).
- **Checkpoints:** Search Console at 4 weeks (any impressions?) and 8 weeks (any queries in positions 1–20?).

---

## 5. Errors and surprises

| # | What happened | Cause | Resolution |
|---|---|---|---|
| 1 | Gemini keyword lists showed CPC and "Zero competition" values | No data source; generated numbers | Treated all keywords as unvalidated |
| 2 | Every page would canonicalise to the homepage | `alternates.canonical` in the **root** layout is inherited by all pages | Removed it there; per-page canonicals |
| 3 | `/solutions` used the homepage title and description | Page file started with `"use client"`, which can't export `metadata` | Split into server page + client component |
| 4 | `/about` canonical has no effect | Pasted inside `openGraph` | ⏳ Move it out |
| 5 | `SyntaxError: Unexpected token 'if'` in `next build` | NOINDEX `if` block pasted inside the `securityHeaders` array | Moved after `];` (companion file) |
| 6 | `/tools` showed the 404 page | Hub calls `notFound()` while no tool is `live` | Set calculator `live`, redeploy |
| 7 | Hub heading slid under the header | Fixed header; my code had no top padding | `pt-28` on hub; ⏳ shell still `py-10` |
| 8 | `processVideo is not defined` | Paste of `metadata-cleaner.ts` cut off at line 334 | Whole file replaced (v2) |
| 9 | Vercel: `Cannot find module '@6over3/zeroperl-ts/zeroperl.wasm'`, `npm error command sh -c node scripts/copy-exiftool-wasm.mjs` | Dependency not in pushed `package.json` / `package-lock.json` | `npm install --save-exact @uswriting/exiftool@1.0.9`, commit both |
| 10 | Engine would load from `/tools/zeroperl.wasm` (404) | Library fetches `./zeroperl.wasm` relative to the page | Custom `fetch` to `/vendor/zeroperl.wasm` + postinstall copy |
| 11 | `-all=` left the video's `CreateDate` | Header dates live in atoms players require | Set the six header dates to zeros |
| 12 | Writing `Time:All` added new junk tags (XMP, `Keys:Year`, `ItemList:ReleaseDate`) | The broad tag group creates tags | Only the six `QuickTime:` date tags |
| 13 | `CompressorName` ("Lavc… libx264") and `VendorID` ("FFmpeg") survived `-all=` | Stored in the codec description, not writable by ExifTool | Zeroed in place by `blankEncoderFields` |
| 14 | Next.js bundles a second copy of `zeroperl.wasm` into `.next/static/media` | Turbopack follows the library's asset reference | Harmless: 25 MB of extra static files |
| 15 | I said `app/robots.ts` + `public/robots.txt` would fail the build | Wrong: the build passed with both | Still remove one to avoid confusion |

---

## 6. Corrections / important decisions

### Corrections to my own advice

1. **The extension is not the core product.** The report treated it as the scan product; you corrected that scans are web-app only.
2. **Over-complicated plan.** Phases 0–4 with 10 tools was too much; simplified to the two-file pattern.
3. **robots.txt:** I advised generating it in code. That gained nothing; reverted to the static file.
4. **"Both robots files break the build"** was wrong.
5. **Header overlap** was my omission in the hub and shell code.
6. **`'wasm-unsafe-eval'`:** after metadata v1 (no WebAssembly) I said you could remove it; v2 needs it. Keep it.
7. **Metadata v1 → v2:** v1 removed only the fields it knew about and showed a short list. It didn't meet your "show everything, remove everything" requirement.
8. **Policy labels:** I argued rejections usually carry a label. Your direct experience is that they never did, so the tool was built for no-reason rejections.

### Decisions

- **One CTA per tool**, to `/signup?src=<slug>&utm_source=free-tool&utm_medium=cta&utm_campaign=<slug>`.
- **No ban-evasion framing or keywords** anywhere. The metadata tool page says outright that it doesn't change ad review or hide accounts.
- **No ad-copy checker** for now.
- **No per-label rejection pages**; one "no reason" page per platform. Facebook is built; TikTok and Google are future candidates.
- **Static `public/robots.txt` and `public/sitemap.xml`.**
- **Photos keep Orientation and ICC profile** (display instructions, not personal data).
- **Metadata tool limit: 1 GB**, because the cleaned copy is built in memory.
- **`ignoreBuildErrors: true` stays for now**; run `npx tsc --noEmit` before pushing.

---

## 7. Open items checklist

- [ ] **`/about` canonical.** In `app/about/page.tsx`, move `alternates: { canonical: '/about' },` out of `openGraph` so it sits just before the final `};`.
- [ ] **Keyword.** In `app/layout.tsx`, delete `'ad account ban prevention',` from `keywords`.
- [ ] **Insurance copy.** In `components/ad-account-insurance.tsx`, replace the body "Every compliant ad strengthens your account history. Faster approvals, better delivery, more leniency. …" with an honest line, e.g. "Every rejection and restriction stays on your account's record. Catching likely problems before upload means fewer of them."
- [ ] **Robots file.** Delete `app/robots.ts` in test **and** live. The drift monitor copied it from live.
- [ ] **Sitemap.** Add the URLs from [Appendix A](#appendix-a--site-seo-fixes-exact-edits) to `public/sitemap.xml`.
- [ ] **Shell padding.** In `components/tools/tool-page-shell.tsx`, line 28: `py-10` → `pt-28 pb-10`.
- [ ] **Git ignore.** Add `public/vendor/zeroperl.wasm` to `.gitignore`.
- [ ] **Lint.** Run `npm i -D eslint eslint-config-next`, or delete the `lint` script.
- [ ] **Attribution.** Read `app/signup` and confirm `src` is saved on the account (e.g. an `acquisition_source` column).
- [ ] **Rejection tool links.** Replace generic `META_STANDARDS` links with direct Meta policy URLs as you verify each one.
- [ ] **Browser tests** for all three tools ([Appendix F](#appendix-f--verification-and-troubleshooting-commands)).
- [ ] **Keyword validation** for each tool's main terms (Ahrefs / Semrush / incognito Google).
- [ ] **Chrome Web Store listing.** Remove the scan feature; point to the web app.
- [ ] **Port to live** ([section 8](#8-porting-to-live-step-by-step)), then Search Console and the 4- and 8-week checks.

---

## 8. Porting to LIVE: step by step

Do the [open items](#7-open-items-checklist) in test first, so live gets the finished versions.

1. **Compare live with test** for `app/layout.tsx`, `app/page.tsx`, `next.config.mjs`, `middleware.ts`, `package.json` and `components/footer.tsx`. The drift monitor may already have copied some files in either direction.
2. **Site SEO fixes:** apply everything in [Appendix A](#appendix-a--site-seo-fixes-exact-edits).
3. **Framework:** copy the five files in [Appendix B](#appendix-b--tool-framework-files), using the corrected shell padding.
4. **Tools:** copy `app/tools/break-even-roas-calculator/`, `app/tools/facebook-ad-rejected-no-reason/` and `app/tools/video-metadata-remover/` ([Appendices C–E](#appendix-c--roas-calculator)).
5. **Metadata engine,** in the live project folder:
   ```
   npm install --save-exact @uswriting/exiftool@1.0.9
   ```
   Then:
   - create `lib/tools/metadata-cleaner.ts` and `scripts/copy-exiftool-wasm.mjs`
   - add `"postinstall": "node scripts/copy-exiftool-wasm.mjs"` to `package.json` scripts
   - add `public/vendor/zeroperl.wasm` to `.gitignore`
   - run `npm run postinstall`

   **Expected output:** `Copied ExifTool engine to …/public/vendor/zeroperl.wasm`, file about 25 MB.
6. **CSP:** `script-src` must include `"'wasm-unsafe-eval'"`.
7. **Middleware matcher** must exclude `vendor`:
   ```ts
   '/((?!_next/static|_next/image|favicon.ico|images|vendor).*)'
   ```
   The basic-auth version of `middleware.ts` is safe on live as long as its variables aren't set (companion file).
8. **Never on live:** `NOINDEX`, `BASIC_AUTH_USER` or `BASIC_AUTH_PASSWORD`.
9. **Sitemap and robots:** add the tool URLs to `public/sitemap.xml`, and delete `app/robots.ts`.
10. **Build:** run `npm run build`. **Expected:** the route list includes `○ /tools`, `○ /tools/break-even-roas-calculator`, `○ /tools/facebook-ad-rejected-no-reason` and `○ /tools/video-metadata-remover`.
11. **Commit** `package.json` and `package-lock.json` along with everything else, then push. **Expected in the Vercel build log,** right after `> node scripts/copy-exiftool-wasm.mjs`: `Copied ExifTool engine to /vercel/path0/public/vendor/zeroperl.wasm`.
12. **After deploy, check:**
    - `https://mediacrater.com/vendor/zeroperl.wasm` downloads
    - `/tools` lists three cards
    - page source of each tool shows `<link rel="canonical" href="https://mediacrater.com/tools/<slug>">`
13. **Run the browser tests** in [Appendix F](#appendix-f--verification-and-troubleshooting-commands) on desktop and phone.
14. **Search Console:**
    - Sitemaps → submit `sitemap.xml`. **Expected:** status "Success".
    - URL Inspection → **Request indexing** for `/tools` and each tool URL.
15. **Search Console → Performance**, filtered to `/tools/`, at **4 weeks** (impressions?) and **8 weeks** (queries in positions 1–20?). Impressions but few clicks means rewriting titles. Nothing after 8 weeks means backlinks or easier keywords.

---

## 9. Reference: key settings

| Item | Value |
|---|---|
| Tool routes | `/tools`, `/tools/break-even-roas-calculator`, `/tools/facebook-ad-rejected-no-reason`, `/tools/video-metadata-remover` |
| Extension landing page (planned, not built) | `/facebook-ads-library-downloader`, CTA = Chrome Web Store install |
| CTA link format | `/signup?src=<slug>&utm_source=free-tool&utm_medium=cta&utm_campaign=<slug>` |
| Homepage insurance CTA | `/signup?src=home-insurance&utm_source=website&utm_medium=cta&utm_campaign=home-insurance` |
| Influencer link format (advised) | `/signup?src=inf-<name>` |
| Adding a tool | Registry line (`status: "draft"`), `app/tools/<slug>/tool.tsx` (client), `app/tools/<slug>/page.tsx` (server), then `status: "live"` + sitemap entry |
| ExifTool package | `@uswriting/exiftool` **1.0.9** (exact), pulls in `@6over3/zeroperl-ts` |
| Engine file | `public/vendor/zeroperl.wasm` (copied by `postinstall`, not committed) |
| Metadata limits | 1 GB per file; JPG, PNG, WebP, HEIC, GIF, TIFF, MP4, MOV, M4V |
| CSP requirement | `'wasm-unsafe-eval'` in `script-src`; `connect-src 'self'` covers the engine fetch |
| Header offset | Fixed header is 64 px (`h-16`); page content needs `pt-28` (112 px) like the homepage hero |
| Calculator defaults → expected outputs | Price 60, product cost 18, shipping 6, fee 2.9% + 0.30, refunds 3%, target 10%, conversion 2% → margin $32.16 (53.6%), break-even 1.87x / $32.16 / CPC $0.64, target 2.29x / $26.16 / CPC $0.52 |

---

## Appendix A – Site SEO fixes (exact edits)

**`app/layout.tsx`**: delete these lines from the `metadata` object:
```ts
  alternates: {
    canonical: 'https://mediacrater.com',
  },
```
Set the description:
```ts
  description: 'Scan video ads for potential Meta, TikTok and Google policy issues before you upload. Get timestamped findings and suggested fixes.',
```
and delete `'ad account ban prevention',` from `keywords` (⏳ open).

**`app/page.tsx`**: add above `export default function Home()`:
```ts
import type { Metadata } from "next"

export const metadata: Metadata = {
  alternates: { canonical: "/" },
}
```

**`app/about/page.tsx`**: the final shape (⏳ the line currently sits inside `openGraph`):
```ts
export const metadata = {
  title: '…unchanged…',
  description: '…unchanged…',
  openGraph: {
    title: '…unchanged…',
    description: '…unchanged…',
    images: ['/images/about-og.png'],
  },
  alternates: { canonical: '/about' },
};
```

**`app/solutions/`**: rename the old `page.tsx` to `solutions-client.tsx`, keep `"use client"` at its top, change `export default function SolutionsPage()` to `export function SolutionsClient()`, then create the server page (as in the repo):

```tsx
   //app/solutions/page.tsx
   import type { Metadata } from "next"
   import { SolutionsClient } from "./solutions-client"

   export const metadata: Metadata = {
     title: "Custom Solutions & API Access | Mediacrater",
     description: "API access, higher volume and custom compliance pipelines for agencies, platforms and high-volume ad teams.",
     alternates: { canonical: "/solutions" },
   }

   export default function SolutionsPage() {
     return <SolutionsClient />
   }
```

**`components/ad-account-insurance.tsx`**:
```ts
const SIGNUP_URL = '/signup?src=home-insurance&utm_source=website&utm_medium=cta&utm_campaign=home-insurance'
```
The `<a>` uses `href={SIGNUP_URL}` with no `target="_blank"` or `rel`. Copy changes are listed in [section 7](#7-open-items-checklist).

**`components/footer.tsx`**:
- line 38 text: `Scan video and image ads for likely policy issues before you upload.`
- anchors: `href="/#features"`, `href="/#how-it-works"`, `href="/#faq"`
- a `Free tools` link: `<Link href="/tools">`

**`next.config.mjs`**:
```js
'script-src': ["'self'", "'unsafe-inline'", "'wasm-unsafe-eval'", TURNSTILE, CF_INSIGHTS_SCRIPT],
```

**`public/robots.txt`** (current, keep):
```text
User-agent: *
Allow: /
Disallow: /api/
Disallow: /db/
Disallow: /dashboard
Disallow: /settings
Disallow: /scan-history
Disallow: /auth/

Sitemap: https://mediacrater.com/sitemap.xml
```

**`public/sitemap.xml`**: add before `</urlset>` (⏳ open):
```xml
<url>
  <loc>https://mediacrater.com/solutions</loc>
</url>
<url>
  <loc>https://mediacrater.com/tools</loc>
</url>
<url>
  <loc>https://mediacrater.com/tools/break-even-roas-calculator</loc>
</url>
<url>
  <loc>https://mediacrater.com/tools/facebook-ad-rejected-no-reason</loc>
</url>
<url>
  <loc>https://mediacrater.com/tools/video-metadata-remover</loc>
</url>
```

**Delete**: `sitemap.xml` in the repo root (✅ done) and `app/robots.ts` (⏳ open).

---

## Appendix B – Tool framework files

All files below are exactly as in the test repo at `eb36cba`.

### `lib/tools/registry.ts`

```ts
//lib/tools/registry.ts
export type ToolStatus = "live"

export interface ToolDef {
  slug: string
  name: string // H1 and link label
  title: string // <title>, 60 characters or fewer
  description: string // meta description, 155 characters or fewer
  ctaText: string
  status: ToolStatus
  lastVerified: string // ISO date the rules/specs were last checked against official sources
}

export const TOOLS: ToolDef[] = [
  { slug: "video-metadata-remover", name: "Remove Metadata From Videos and Photos", title: "Remove Video & Photo Metadata Free (No Upload) | Mediacrater", description: "See the GPS, device, author and software data in your video or image, then download a clean copy. Processed on your device.", ctaText: "File cleaned. Check the content before launch", status: "live", lastVerified: "2026-10-12" },
  { slug: "break-even-roas-calculator", name: "Ecommerce Ads Profit Calculator", title: "Break-Even ROAS & CPA Calculator | Mediacrater", description: "Calculate break-even ROAS, target ROAS, max CPA and max CPC from contribution margin, with the formulas shown. No signup.", ctaText: "Margins assume the ad gets approved. Scan it first", status: "live", lastVerified: "2026-10-12" },
  { slug: "facebook-ad-rejected-no-reason", name: "Facebook Ad Rejected With No Reason? Find Likely Causes", title: "Facebook Ad Rejected With No Reason? | Mediacrater", description: "Facebook rejected your ad without saying why? Tick what's in it to see which Meta policies likely apply, with official links. Free, no signup.", ctaText: "Meta won't tell you which part caused it. Scan the ad to find likely triggers.", status: "live", lastVerified: "2026-10-12" },
]

export const liveTools = (): ToolDef[] => TOOLS.filter((t) => t.status === "live")

export function getTool(slug: string): ToolDef {
  const tool = TOOLS.find((t) => t.slug === slug)
  if (!tool) throw new Error(`Unknown tool slug: ${slug}`)
  return tool
}
```

### `lib/tools/cta.ts`

```ts
//lib/tools/cta.ts
/** Builds the single CTA link for a tool. `src` is what signup should store for attribution. */
export function signupUrl(slug: string): string {
  const params = new URLSearchParams({
    src: slug,
    utm_source: "free-tool",
    utm_medium: "cta",
    utm_campaign: slug,
  })
  return `/signup?${params.toString()}`
}
```

### `components/tools/json-ld.tsx`

```tsx
//components/tools/json-ld.tsx
/** Renders structured data. "<" is escaped so no string can ever close the script tag. */
export function JsonLd({ data }: { data: Record<string, unknown> }) {
  const json = JSON.stringify(data).replace(/</g, "\\u003c")
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: json }} />
}
```

### `components/tools/tool-page-shell.tsx`

⏳ **Change before porting:** line 28 `py-10` → `pt-28 pb-10`.

```tsx
//components/tools/tool-page-shell.tsx
import Link from "next/link"
import type { ReactNode } from "react"
import { Header } from "@/components/header"
import { Footer } from "@/components/footer"
import { JsonLd } from "@/components/tools/json-ld"
import { liveTools, type ToolDef } from "@/lib/tools/registry"
import { signupUrl } from "@/lib/tools/cta"

const SITE = "https://mediacrater.com"

interface ToolPageShellProps {
  tool: ToolDef
  intro: string
  children: ReactNode // the interactive client component
  method: ReactNode // how it works + official sources
  limits: string[]
  faqs: { q: string; a: string }[]
}

export function ToolPageShell({ tool, intro, children, method, limits, faqs }: ToolPageShellProps) {
  const url = `${SITE}/tools/${tool.slug}`
  const related = liveTools().filter((t) => t.slug !== tool.slug).slice(0, 4)

  return (
    <>
      <Header />
      <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        <JsonLd
          data={{
            "@context": "https://schema.org",
            "@graph": [
              {
                "@type": "WebApplication",
                name: tool.name,
                url,
                description: tool.description,
                applicationCategory: "BusinessApplication",
                operatingSystem: "Any (web browser)",
                isAccessibleForFree: true,
                offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
                publisher: { "@type": "Organization", name: "Mediacrater", url: SITE },
              },
              {
                "@type": "BreadcrumbList",
                itemListElement: [
                  { "@type": "ListItem", position: 1, name: "Home", item: SITE },
                  { "@type": "ListItem", position: 2, name: "Free tools", item: `${SITE}/tools` },
                  { "@type": "ListItem", position: 3, name: tool.name, item: url },
                ],
              },
            ],
          }}
        />

        <nav aria-label="Breadcrumb" className="text-xs text-muted-foreground">
          <Link href="/tools" className="hover:underline">Free tools</Link> / {tool.name}
        </nav>

        <h1 className="mt-3 font-[family-name:var(--font-display)] text-3xl font-bold tracking-[-0.03em] sm:text-4xl">
          {tool.name}
        </h1>
        <p className="mt-3 text-muted-foreground">{intro}</p>
        <p className="mt-2 text-xs text-muted-foreground">
          Runs in your browser. Your text and files are never uploaded.
        </p>

        <section aria-label="Tool" className="mt-8">{children}</section>

        <section className="mt-10 rounded-xl border border-border bg-card p-6">
          <p className="font-semibold">{tool.ctaText}</p>
          <Link
            href={signupUrl(tool.slug)}
            className="mt-4 inline-flex w-full items-center justify-center rounded-lg bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground hover:opacity-90 sm:w-auto"
          >
            Scan your creative with Mediacrater
          </Link>
          <p className="mt-2 text-xs text-muted-foreground">3 free scans every month. No credit card.</p>
        </section>

        <section className="mt-12">
          <h2 className="text-xl font-bold">How it works</h2>
          <div className="mt-3 space-y-3 text-sm leading-relaxed text-muted-foreground">{method}</div>
          <p className="mt-3 text-xs text-muted-foreground">
            Last checked against official sources: {tool.lastVerified}
          </p>
        </section>

        <section className="mt-10">
          <h2 className="text-xl font-bold">Limitations</h2>
          <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
            {limits.map((l) => <li key={l}>{l}</li>)}
          </ul>
        </section>

        <section className="mt-10">
          <h2 className="text-xl font-bold">FAQ</h2>
          <div className="mt-3 divide-y divide-border border-y border-border">
            {faqs.map((f) => (
              <details key={f.q} className="py-3">
                <summary className="cursor-pointer text-sm font-medium">{f.q}</summary>
                <p className="mt-2 text-sm text-muted-foreground">{f.a}</p>
              </details>
            ))}
          </div>
        </section>

        {related.length > 0 && (
          <section className="mt-10">
            <h2 className="text-xl font-bold">More free tools</h2>
            <ul className="mt-3 grid gap-2 sm:grid-cols-2">
              {related.map((t) => (
                <li key={t.slug}>
                  <Link href={`/tools/${t.slug}`} className="block rounded-lg border border-border p-3 text-sm hover:bg-card">
                    {t.name}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
      <Footer />
    </>
  )
}
```

### `app/tools/page.tsx` (hub)

```tsx
//app/tools/page.tsx
import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { Header } from "@/components/header"
import { Footer } from "@/components/footer"
import { liveTools } from "@/lib/tools/registry"

export const metadata: Metadata = {
  title: "Free Ad Creative & Policy Tools | Mediacrater",
  description: "Free, no-signup tools for media buyers: ad copy policy checks, safe zones, spec checks and more. Everything runs in your browser.",
  alternates: { canonical: "/tools" },
}

export default function ToolsHub() {
  const tools = liveTools()
  if (tools.length === 0) notFound() // never publish an empty hub

  return (
    <>
      <Header />
       <main className="mx-auto max-w-5xl px-4 pt-28 pb-12 sm:px-6">
        <h1 className="font-[family-name:var(--font-display)] text-4xl font-bold tracking-[-0.035em]">Free tools for media buyers</h1>
        <p className="mt-3 max-w-2xl text-muted-foreground">No signup. Your files and text stay on your device.</p>
        <ul className="mt-10 grid gap-4 sm:grid-cols-2">
          {tools.map((t) => (
            <li key={t.slug}>
              <Link href={`/tools/${t.slug}`} className="block h-full rounded-xl border border-border bg-card p-5 hover:border-primary">
                <h2 className="font-semibold">{t.name}</h2>
                <p className="mt-2 text-sm text-muted-foreground">{t.description}</p>
              </Link>
            </li>
          ))}
        </ul>
      </main>
      <Footer />
    </>
  )
}
```

---

## Appendix C – ROAS calculator

### `app/tools/break-even-roas-calculator/tool.tsx`

```tsx
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
```

### `app/tools/break-even-roas-calculator/page.tsx`

```tsx
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
```

---

## Appendix D – "Facebook ad rejected with no reason" triage

### `app/tools/facebook-ad-rejected-no-reason/tool.tsx`

```tsx
//app/tools/facebook-ad-rejected-no-reason/tool.tsx
"use client"

import { useMemo, useState } from "react"

// ---------------------------------------------------------------------------
// DATA
// Each "signal" is something the user can tick. Each signal points to one or
// more Meta policy areas. To edit the tool's content, edit these two lists.
// Keep every claim checkable against Meta's published Advertising Standards.
// ---------------------------------------------------------------------------

const META_STANDARDS = "https://transparency.meta.com/policies/ad-standards/"
const META_PERSONAL_ATTRIBUTES =
  "https://transparency.meta.com/policies/ad-standards/objectionable-content/privacy-violations-personal-attributes/"

type AreaId =
  | "personal" | "health" | "misleading" | "lowquality" | "adult" | "shocking"
  | "ip" | "restricted" | "prohibited" | "special" | "landing" | "rereview"

const AREAS: Record<AreaId, { name: string; summary: string; url: string }> = {
  personal: {
    name: "Personal attributes",
    summary: "Ads can't imply they know something personal about the viewer, such as their health, finances, body, age, religion or identity.",
    url: META_PERSONAL_ATTRIBUTES,
  },
  health: {
    name: "Health and wellness",
    summary: "Detailed rules for weight loss, supplements, cosmetic products and procedures, health claims, and how bodies are shown.",
    url: META_STANDARDS,
  },
  misleading: {
    name: "Misleading or deceptive claims",
    summary: "Claims, prices, testimonials or results that can't be backed up or don't match what people actually get.",
    url: META_STANDARDS,
  },
  lowquality: {
    name: "Low quality or disruptive content",
    summary: "Clickbait, sensational wording, fake interface elements and poor landing page experiences.",
    url: META_STANDARDS,
  },
  adult: {
    name: "Adult content and sexual suggestiveness",
    summary: "Nudity, implied nudity, and images focused on body parts, even when nothing explicit is shown.",
    url: META_STANDARDS,
  },
  shocking: {
    name: "Shocking or graphic content",
    summary: "Blood, injuries, medical procedures and other images meant to shock or scare.",
    url: META_STANDARDS,
  },
  ip: {
    name: "Intellectual property and impersonation",
    summary: "Other brands' logos or content, copyrighted music, and public figures used without permission.",
    url: META_STANDARDS,
  },
  restricted: {
    name: "Restricted goods and services",
    summary: "Allowed only with extra requirements, such as permission from Meta, certification, licences or age targeting.",
    url: META_STANDARDS,
  },
  prohibited: {
    name: "Prohibited goods and services",
    summary: "Products that can't be advertised at all. Editing the ad won't fix this.",
    url: META_STANDARDS,
  },
  special: {
    name: "Special Ad Categories and social issues",
    summary: "Housing, employment, credit, and ads about social issues, elections or politics must be declared in Ads Manager. Social issue ads also need authorization and a disclaimer.",
    url: META_STANDARDS,
  },
  landing: {
    name: "Landing page",
    summary: "Meta reviews where your ad leads, not only the ad itself.",
    url: META_STANDARDS,
  },
  rereview: {
    name: "Re-review after approval",
    summary: "Ads can be reviewed again at any time, including after edits, so an approved ad can still be rejected later.",
    url: META_STANDARDS,
  },
}

type Group = "Ad copy" | "Image or video" | "What you sell" | "Landing page" | "Ad history"
const GROUPS: Group[] = ["Ad copy", "Image or video", "What you sell", "Landing page", "Ad history"]

interface Signal {
  id: string
  group: Group
  label: string
  example?: string
  areas: AreaId[]
  check: string
}

const SIGNALS: Signal[] = [
  // Ad copy
  { id: "you-attribute", group: "Ad copy", label: "Says “you” or “your” next to a health condition, body feature, money situation, age or identity", example: "“Struggling with your weight?” “Tired of being in debt?”", areas: ["personal"], check: "Describe the product, not the viewer: “Our debt coaching program” instead of “Tired of being in debt?”" },
  { id: "health-claim", group: "Ad copy", label: "Promises health results, cures or specific weight loss", example: "“Lose 10 kg in 30 days”", areas: ["health", "misleading"], check: "Remove specific numbers and timelines, and any claim to cure, treat or prevent a condition." },
  { id: "income", group: "Ad copy", label: "Promises earnings or financial results", example: "“Make $5,000 a month from home”", areas: ["misleading"], check: "Remove guaranteed or specific income figures. Describe what the product is, not what the viewer will earn." },
  { id: "urgency", group: "Ad copy", label: "Uses countdowns, low-stock warnings or deadlines that aren't real", example: "“Only 2 left!” on an item that's always in stock", areas: ["misleading", "lowquality"], check: "Keep only real deadlines and stock levels, and make sure they match your landing page." },
  { id: "sensational", group: "Ad copy", label: "Clickbait or sensational wording", example: "“You won't believe…”, “Doctors hate this”, ALL CAPS, lots of !!!", areas: ["lowquality"], check: "Say what the product is and what it does in plain words." },

  // Image or video
  { id: "before-after", group: "Image or video", label: "Before-and-after comparison of a body, face or skin", areas: ["health"], check: "Check the current Health and Wellness rules for your product type before using these images. They're strict and detailed." },
  { id: "body-focus", group: "Image or video", label: "Close-ups of body parts or skin, or revealing clothing", areas: ["adult", "health"], check: "Show the product in use without zooming in on bodies, and avoid poses that could read as sexual." },
  { id: "fake-ui", group: "Image or video", label: "Fake buttons, play icons, notification badges or system messages", areas: ["lowquality", "misleading"], check: "Remove anything that looks clickable but isn't the real ad button." },
  { id: "shocking", group: "Image or video", label: "Blood, injuries, medical procedures or deliberately scary images", areas: ["shocking"], check: "Replace with non-graphic visuals." },
  { id: "brand-celeb", group: "Image or video", label: "Other brands' logos, celebrities, news-site styling or popular music", areas: ["ip", "misleading"], check: "Use only assets you own or have licensed, and never imply an endorsement you don't have." },
  { id: "testimonials", group: "Image or video", label: "Testimonials, reviews or results that aren't real or typical", areas: ["misleading"], check: "Use only real customers' words and results people can actually expect." },
  { id: "in-video-text", group: "Image or video", label: "On-screen text or voiceover says more than the ad copy does", areas: ["personal", "health", "misleading"], check: "Review covers what's shown and said inside the image or video, not only the text fields. Check every caption and spoken line." },

  // What you sell
  { id: "supplements", group: "What you sell", label: "Supplements, weight loss products, or cosmetic products and procedures", areas: ["health", "restricted"], check: "These come with extra rules on claims, images and age targeting." },
  { id: "restricted", group: "What you sell", label: "Alcohol, gambling, dating, financial services, crypto, or an online pharmacy", areas: ["restricted"], check: "Some of these need permission or certification from Meta before advertising, others need age targeting. Check the requirement for your category." },
  { id: "prohibited", group: "What you sell", label: "Tobacco or vapes, weapons or ammunition, illegal or recreational drugs, or adult products", areas: ["prohibited"], check: "Ads for these generally aren't allowed at all, so changing the creative won't fix it." },
  { id: "special", group: "What you sell", label: "Housing, jobs, loans or credit, or anything political or about social issues", areas: ["special"], check: "Declare the Special Ad Category when creating the campaign. Social issue ads also need authorization." },

  // Landing page
  { id: "lp-mismatch", group: "Landing page", label: "Shows a different product, price or offer than the ad", areas: ["landing", "misleading"], check: "Make the product, price and offer match the ad exactly." },
  { id: "lp-quality", group: "Landing page", label: "Slow, broken, full of pop-ups, or redirects somewhere else", areas: ["landing", "lowquality"], check: "Test it on a phone, and remove automatic redirects and intrusive pop-ups." },
  { id: "lp-trust", group: "Landing page", label: "No contact details, privacy policy or refund policy on the site", areas: ["landing"], check: "Add clear contact information and the policies a customer would expect." },
  { id: "lp-other-products", group: "Landing page", label: "The site also sells or links to restricted or prohibited products", areas: ["landing", "restricted"], check: "Meta reviews the landing page too, including what else it sells. Remove or separate those products." },

  // Ad history
  { id: "edited-live", group: "Ad history", label: "It was approved and running, then rejected after you edited it", areas: ["rereview"], check: "Edits send the ad back into review. Compare exactly what changed." },
  { id: "ran-then-rejected", group: "Ad history", label: "It ran fine, then got rejected without any changes", areas: ["rereview"], check: "Ads can be re-reviewed at any time, for example after people hide or report them. The original content is judged again." },
]

const AREA_ORDER = Object.keys(AREAS) as AreaId[]

// ---------------------------------------------------------------------------
// COMPONENT
// ---------------------------------------------------------------------------

export function RejectionTriage() {
  const [ticked, setTicked] = useState<Set<string>>(new Set())

  const toggle = (id: string) =>
    setTicked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  // Group ticked signals by policy area; most matches first.
  const results = useMemo(() => {
    const byArea = new Map<AreaId, Signal[]>()
    for (const s of SIGNALS) {
      if (!ticked.has(s.id)) continue
      for (const a of s.areas) byArea.set(a, [...(byArea.get(a) ?? []), s])
    }
    return [...byArea.entries()].sort(
      (a, b) => b[1].length - a[1].length || AREA_ORDER.indexOf(a[0]) - AREA_ORDER.indexOf(b[0])
    )
  }, [ticked])

  return (
    <div className="rounded-xl border border-border bg-card p-4 sm:p-6">
      <p className="text-sm font-semibold">Tick everything that's true about your rejected ad</p>

      <div className="mt-4 space-y-6">
        {GROUPS.map((group) => (
          <fieldset key={group}>
            <legend className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{group}</legend>
            <div className="mt-2 space-y-2">
              {SIGNALS.filter((s) => s.group === group).map((s) => (
                <label
                  key={s.id}
                  className="flex cursor-pointer gap-3 rounded-lg border border-border bg-background p-3 hover:border-primary"
                >
                  <input
                    type="checkbox"
                    checked={ticked.has(s.id)}
                    onChange={() => toggle(s.id)}
                    className="mt-0.5 h-5 w-5 shrink-0 accent-[var(--primary)]"
                  />
                  <span className="text-sm">
                    {s.label}
                    {s.example && <span className="mt-0.5 block text-xs text-muted-foreground">e.g. {s.example}</span>}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        ))}
      </div>

      <div aria-live="polite" className="mt-8 border-t border-border pt-6">
        {results.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Tick what's in your ad to see which policy areas it most likely falls under.
          </p>
        ) : (
          <>
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-semibold">Most likely policy areas</p>
              <button
                type="button"
                onClick={() => setTicked(new Set())}
                className="text-xs text-muted-foreground underline hover:text-foreground"
              >
                Clear all
              </button>
            </div>

            <ol className="mt-4 space-y-4">
              {results.map(([areaId, signals]) => {
                const area = AREAS[areaId]
                return (
                  <li key={areaId} className="rounded-lg border border-border bg-background p-4">
                    <div className="flex items-baseline justify-between gap-3">
                      <h3 className="font-semibold">{area.name}</h3>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {signals.length} {signals.length === 1 ? "match" : "matches"}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">{area.summary}</p>
                    <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm">
                      {signals.map((s) => <li key={s.id}>{s.check}</li>)}
                    </ul>
                    <a
                      href={area.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-3 inline-block text-xs font-medium text-primary hover:underline"
                    >
                      Read Meta's policy →
                    </a>
                  </li>
                )
              })}
            </ol>

            <p className="mt-4 text-xs text-muted-foreground">
              These are common causes based on what you ticked, not a diagnosis. Meta doesn't say which part of an ad
              triggered a rejection, so more than one of these may apply, or none of them.
            </p>
          </>
        )}
      </div>
    </div>
  )
}
```

### `app/tools/facebook-ad-rejected-no-reason/page.tsx`

```tsx
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
```

---

## Appendix E – Metadata remover (ExifTool)

### Install and wiring

```
npm install --save-exact @uswriting/exiftool@1.0.9
```

`package.json` → `"scripts"` gets:
```json
"postinstall": "node scripts/copy-exiftool-wasm.mjs"
```
and `"dependencies"` gets (added by the install command):
```json
"@uswriting/exiftool": "1.0.9",
```

`.gitignore` (⏳ open):
```
public/vendor/zeroperl.wasm
```

### `scripts/copy-exiftool-wasm.mjs`

```js
//scripts/copy-exiftool-wasm.mjs
// Copies the ExifTool engine (a WebAssembly file) into /public so browsers load it
// from mediacrater.com itself, never from a third-party CDN.
// Runs automatically after every `npm install`, including on Vercel.
import { copyFileSync, mkdirSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join } from "node:path"

const require = createRequire(import.meta.url)
const source = require.resolve("@6over3/zeroperl-ts/zeroperl.wasm")
const target = join(process.cwd(), "public", "vendor", "zeroperl.wasm")

mkdirSync(dirname(target), { recursive: true })
copyFileSync(source, target)
console.log(`Copied ExifTool engine to ${target}`)
```

### `lib/tools/metadata-cleaner.ts`

Check the end of the file after pasting: it must end with the closing `}` of `blankEncoderFields` (257 lines).

```ts
//lib/tools/metadata-cleaner.ts
/**
 * Full metadata viewer & remover, powered by ExifTool (by Phil Harvey) compiled to
 * WebAssembly. Everything runs in the visitor's browser: files are never uploaded.
 *
 * The engine (~8 MB compressed) is only downloaded when someone actually picks a
 * file, so it doesn't slow down the page itself.
 */

export interface MetaField {
  group: string // ExifTool group, e.g. "GPS", "IFD0", "Track1"
  tag: string // ExifTool tag name, e.g. "GPSLatitude"
  label: string // readable version, e.g. "GPS Latitude"
  value: string
  sensitive: boolean // could identify a person, place, device or workflow
}

export interface MetadataReport {
  fileType: string // ExifTool's file type, e.g. "JPEG", "MP4", "MOV"
  details: { label: string; value: string }[] // summary: type, size, dimensions, codec...
  fields: MetaField[] // every metadata field ExifTool found
  warnings: string[]
}

export const MAX_FILE_BYTES = 1024 ** 3 // 1 GB: the cleaned copy is built in memory
export const ACCEPT =
  ".jpg,.jpeg,.png,.webp,.heic,.heif,.gif,.tif,.tiff,.mp4,.mov,.m4v," +
  "image/jpeg,image/png,image/webp,image/heic,image/heif,image/gif,image/tiff,video/mp4,video/quicktime"

const WASM_URL = "/vendor/zeroperl.wasm" // copied there by scripts/copy-exiftool-wasm.mjs
const VIDEO_TYPES = new Set(["MOV", "MP4", "M4V", "3GP", "3G2"])
const ZERO_DATE = "0000:00:00 00:00:00"

// ---------------------------------------------------------------------------
// Engine loading
// ---------------------------------------------------------------------------

type ExifToolModule = typeof import("@uswriting/exiftool")
let engine: Promise<ExifToolModule> | null = null

/** Loads ExifTool once, on first use. */
function loadEngine(): Promise<ExifToolModule> {
  engine ??= import("@uswriting/exiftool")
  return engine
}

/** The library would otherwise fetch the engine relative to the current page URL. */
const wasmFetch = () => fetch(WASM_URL)

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Reads every metadata field in the file. */
export async function inspectFile(file: File): Promise<MetadataReport> {
  if (file.size > MAX_FILE_BYTES) throw new Error("Files larger than 1 GB aren't supported.")
  const { parseMetadata } = await loadEngine()
  const result = await parseMetadata<Record<string, unknown>>(file, {
    args: ["-json", "-G1", "-a", "-s"],
    fetch: wasmFetch,
    transform: (out) => JSON.parse(out)[0] ?? {},
  })
  if (!result.success) {
    throw new Error("Couldn't read this file. It may be damaged or in a format that isn't supported.")
  }
  return buildReport(result.data, file)
}

/** Removes all removable metadata and returns the clean file plus a fresh report of it. */
export async function cleanFile(file: File, fileType: string): Promise<{ file: File; report: MetadataReport }> {
  const { writeMetadata } = await loadEngine()
  const isVideo = VIDEO_TYPES.has(fileType)

  // "-all=" deletes every tag ExifTool can write.
  const tags: Record<string, string> = { all: "" }

  // Video header dates can't be deleted (players need the fields to exist),
  // so they're blanked out instead.
  if (isVideo) {
    for (const t of ["CreateDate", "ModifyDate", "TrackCreateDate", "TrackModifyDate", "MediaCreateDate", "MediaModifyDate"]) {
      tags[`QuickTime:${t}`] = ZERO_DATE
    }
  }

  // -m: tolerate minor file errors. -q -q: keep harmless warnings out of the error stream.
  const args = ["-m", "-q", "-q"]
  // Photos: put back the two display instructions so the picture doesn't turn
  // sideways or change colour. Neither identifies anyone.
  if (!isVideo) args.push("-tagsFromFile", "@", "-Orientation", "-ICC_Profile")

  const result = await writeMetadata(file, tags, { args, fetch: wasmFetch })
  if (!result.success) {
    throw new Error("Couldn't clean this file. The format may not support metadata removal, or the file is damaged.")
  }

  const bytes = new Uint8Array(result.data)
  if (isVideo) blankEncoderFields(bytes)

  const cleaned = new File([bytes], cleanName(file.name), { type: file.type || "application/octet-stream" })
  return { file: cleaned, report: await inspectFile(cleaned) }
}

// ---------------------------------------------------------------------------
// Report building
// ---------------------------------------------------------------------------

const HIDDEN_GROUPS = new Set(["System", "ExifTool"]) // virtual file-system values, engine version

const SENSITIVE_GROUPS =
  /^(GPS|XMP|IPTC|Photoshop|Keys|ItemList|UserData|MakerNotes|Apple|Canon|Nikon|Sony|Samsung|Panasonic|Olympus|FujiFilm|Google|DJI|GoPro)/
const SENSITIVE_TAGS =
  /GPS|Location|Latitude|Longitude|Altitude|Serial|Owner|Artist|Author|Creator|Copyright|Software|Encoder|Encoded|Writer|Producer|Comment|Title|Keywords|Subject|Lens|History|DocumentID|InstanceID|CompressorName|VendorID|City|Country|Person|Region|Rating|Label|Caption|Headline|Credit|ImageDescription|Make$|Model$|Date|Time$/
const NOT_SENSITIVE = new Set([
  "HandlerDescription", "HandlerType", "HandlerClass", "HandlerVendorID", "ExposureTime",
  "PreviewTime", "PosterTime", "SelectionTime", "CurrentTime",
])

function isSensitive(group: string, tag: string, value: string): boolean {
  if (!value || value.startsWith("0000:00:00")) return false // empty or blanked-out
  if (NOT_SENSITIVE.has(tag)) return false
  return SENSITIVE_GROUPS.test(group) || SENSITIVE_TAGS.test(tag)
}

function formatValue(v: unknown): string {
  const s = Array.isArray(v) ? v.map(String).join(", ") : typeof v === "object" && v !== null ? JSON.stringify(v) : String(v)
  return s.length > 300 ? `${s.slice(0, 297)}…` : s
}

/** "GPSLatitude" → "GPS Latitude", "CompressorID" → "Compressor ID" */
function humanize(tag: string): string {
  return tag.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
}

export function formatBytes(n: number): string {
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`
  return `${(n / 1024 ** 3).toFixed(2)} GB`
}

function buildReport(raw: Record<string, unknown>, file: File): MetadataReport {
  const fields: MetaField[] = []
  const warnings: string[] = []

  for (const [key, rawValue] of Object.entries(raw)) {
    const split = key.indexOf(":")
    if (split < 0) continue // "SourceFile"
    const group = key.slice(0, split)
    const tag = key.slice(split + 1)
    const value = formatValue(rawValue)
    if (group === "ExifTool") {
      if (tag === "Warning" || tag === "Error") warnings.push(value)
      continue
    }
    if (HIDDEN_GROUPS.has(group)) continue
    fields.push({ group, tag, label: humanize(tag), value, sensitive: isSensitive(group, tag, value) })
  }

  const get = (key: string | undefined) => {
    const v = key ? raw[key] : undefined
    return v === undefined || v === "" ? undefined : formatValue(v)
  }
  // Find which numbered track holds the video and which holds the audio.
  const trackFor = (handler: string) =>
    Object.keys(raw).find((k) => /^Track\d+:HandlerType$/.test(k) && raw[k] === handler)?.split(":")[0]
  const video = trackFor("Video Track")
  const audio = trackFor("Audio Track")

  const details: [string, string | undefined][] = [
    ["File name", file.name],
    ["File size", formatBytes(file.size)],
    ["Type", get("File:FileType") ?? get("File:MIMEType")],
    ["Dimensions", get("Composite:ImageSize")],
    ["Duration", get("QuickTime:Duration") ?? get("Composite:Duration")],
    ["Video codec", get(video && `${video}:CompressorID`)],
    ["Frame rate", get(video && `${video}:VideoFrameRate`)],
    ["Average bitrate", get("Composite:AvgBitrate")],
    ["Audio", get(audio && `${audio}:AudioFormat`)],
    ["Audio sample rate", get(audio && `${audio}:AudioSampleRate`)],
    ["Audio channels", get(audio && `${audio}:AudioChannels`)],
    ["Megapixels", get("Composite:Megapixels")],
  ]

  return {
    fileType: String(raw["File:FileType"] ?? ""),
    details: details.filter((d): d is [string, string] => Boolean(d[1])).map(([label, value]) => ({ label, value })),
    fields,
    warnings,
  }
}

function cleanName(name: string): string {
  const dot = name.lastIndexOf(".")
  return dot > 0 ? `${name.slice(0, dot)}-clean${name.slice(dot)}` : `${name}-clean`
}

// ---------------------------------------------------------------------------
// Video: blank the encoder name and vendor code
//
// ExifTool can't remove these because they sit inside the codec description that
// players need. They're fixed-size fields, though, so they can be zeroed in place
// without moving anything else in the file.
// ---------------------------------------------------------------------------

interface Box {
  type: string
  start: number
  body: number
  end: number
}

const latin1 = new TextDecoder("latin1")
const fourcc = (b: Uint8Array, at: number) => latin1.decode(b.subarray(at, at + 4))

/** Lists the boxes between start and end. Stops at anything malformed instead of guessing. */
function boxes(b: Uint8Array, start: number, end: number): Box[] {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength)
  const out: Box[] = []
  let i = start
  while (i + 8 <= end) {
    let size = v.getUint32(i)
    let header = 8
    if (size === 1) {
      if (i + 16 > end) break
      size = Number(v.getBigUint64(i + 8))
      header = 16
    } else if (size === 0) {
      size = end - i
    }
    if (size < header || i + size > end) break
    out.push({ type: fourcc(b, i + 4), start: i, body: i + header, end: i + size })
    i += size
  }
  return out
}

const child = (b: Uint8Array, parent: Box | undefined, type: string) =>
  parent ? boxes(b, parent.body, parent.end).find((x) => x.type === type) : undefined

function blankEncoderFields(b: Uint8Array) {
  for (const moov of boxes(b, 0, b.length).filter((x) => x.type === "moov")) {
    for (const trak of boxes(b, moov.body, moov.end).filter((x) => x.type === "trak")) {
      const mdia = child(b, trak, "mdia")
      const hdlr = child(b, mdia, "hdlr")
      const handler = hdlr && hdlr.end - hdlr.body >= 12 ? fourcc(b, hdlr.body + 8) : ""
      if (handler !== "vide" && handler !== "soun") continue

      const stsd = child(b, child(b, child(b, mdia, "minf"), "stbl"), "stsd")
      if (!stsd) continue
      // stsd: 4 bytes version/flags + 4 bytes entry count, then one entry per codec
      for (const entry of boxes(b, stsd.body + 8, stsd.end)) {
        const e = entry.start // offsets below count from the start of the entry
        if (entry.end - e >= 24) b.fill(0, e + 20, e + 24) // vendor code, e.g. "FFmpeg", "appl"
        if (handler === "vide" && entry.end - e >= 82) b.fill(0, e + 50, e + 82) // encoder name
      }
    }
  }
}
```

### `app/tools/video-metadata-remover/tool.tsx`

```tsx
//app/tools/video-metadata-remover/tool.tsx
"use client"

import { useEffect, useRef, useState } from "react"
import {
  ACCEPT,
  cleanFile,
  formatBytes,
  inspectFile,
  type MetaField,
  type MetadataReport,
} from "@/lib/tools/metadata-cleaner"

// ---------------------------------------------------------------------------
// Report display
// ---------------------------------------------------------------------------

const GROUP_NAMES: Record<string, string> = {
  File: "File",
  Composite: "Calculated by ExifTool (not stored in the file)",
  QuickTime: "Video container",
  Keys: "QuickTime keys",
  ItemList: "Item list tags",
  UserData: "User data",
  IFD0: "EXIF: main image",
  IFD1: "EXIF: thumbnail",
  ExifIFD: "EXIF: camera settings",
  GPS: "GPS",
  JFIF: "JFIF",
  PNG: "PNG",
  RIFF: "WebP",
  IPTC: "IPTC",
  Photoshop: "Photoshop",
}

function groupName(group: string): string {
  if (GROUP_NAMES[group]) return GROUP_NAMES[group]
  const track = group.match(/^Track(\d+)$/)
  if (track) return `Track ${track[1]}`
  if (group.startsWith("XMP-")) return `XMP: ${group.slice(4)}`
  if (group.startsWith("ICC")) return "Colour profile"
  return group
}

function groupFields(fields: MetaField[]): [string, MetaField[]][] {
  const map = new Map<string, MetaField[]>()
  for (const f of fields) map.set(f.group, [...(map.get(f.group) ?? []), f])
  return [...map.entries()]
}

function Report({ report, openGroups = false }: { report: MetadataReport; openGroups?: boolean }) {
  const sensitive = report.fields.filter((f) => f.sensitive)

  return (
    <div className="space-y-5">
      <dl className="grid grid-cols-1 gap-x-6 gap-y-2 rounded-lg border border-border bg-background p-4 sm:grid-cols-2">
        {report.details.map((d) => (
          <div key={d.label} className="flex justify-between gap-3 text-sm">
            <dt className="text-muted-foreground">{d.label}</dt>
            <dd className="min-w-0 break-all text-right font-medium">{d.value}</dd>
          </div>
        ))}
      </dl>

      <div>
        <p className="text-sm font-semibold">
          {sensitive.length === 0
            ? "No privacy-sensitive fields found"
            : `${sensitive.length} privacy-sensitive ${sensitive.length === 1 ? "field" : "fields"}`}
        </p>
        {sensitive.length > 0 && (
          <ul className="mt-2 divide-y divide-amber-500/20 rounded-lg border border-amber-500/40 bg-amber-500/10">
            {sensitive.map((f) => (
              <li key={`${f.group}:${f.tag}`} className="flex flex-col gap-0.5 p-3 sm:flex-row sm:justify-between sm:gap-4">
                <span className="text-sm font-medium">
                  {f.label} <span className="text-xs font-normal text-muted-foreground">· {groupName(f.group)}</span>
                </span>
                <span className="break-all font-mono text-xs sm:text-right">{f.value}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <p className="text-sm font-semibold">All metadata ({report.fields.length} fields)</p>
        <div className="mt-2 space-y-2">
          {groupFields(report.fields).map(([group, fields]) => (
            <details key={group} open={openGroups} className="rounded-lg border border-border bg-background">
              <summary className="cursor-pointer select-none px-3 py-2.5 text-sm font-medium">
                {groupName(group)} <span className="text-muted-foreground">({fields.length})</span>
              </summary>
              <table className="w-full table-fixed border-t border-border text-xs">
                <tbody>
                  {fields.map((f) => (
                    <tr key={f.tag} className="border-b border-border last:border-0 align-top">
                      <td className="w-2/5 px-3 py-2 text-muted-foreground">
                        {f.sensitive && <span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-amber-500" aria-label="Sensitive" />}
                        {f.label}
                      </td>
                      <td className="break-all px-3 py-2 font-mono">{f.value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          ))}
        </div>
      </div>

      {report.warnings.length > 0 && (
        <div className="text-xs text-muted-foreground">
          <p className="font-medium">Notes from ExifTool</p>
          <ul className="mt-1 list-disc pl-5">
            {report.warnings.map((w) => <li key={w}>{w}</li>)}
          </ul>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Tool
// ---------------------------------------------------------------------------

type Busy = "reading" | "cleaning" | null

export function MetadataCleaner() {
  const inputRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [report, setReport] = useState<MetadataReport | null>(null)
  const [busy, setBusy] = useState<Busy>(null)
  const [error, setError] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const [result, setResult] = useState<{ url: string; name: string; report: MetadataReport } | null>(null)

  // Free the download link's memory when it's replaced or the page closes.
  useEffect(() => () => { if (result) URL.revokeObjectURL(result.url) }, [result])

  async function handleFile(f: File) {
    if (busy) return
    setError(null)
    setResult(null)
    setReport(null)
    setFile(f)
    setBusy("reading")
    try {
      setReport(await inspectFile(f))
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't read this file.")
      setFile(null)
    } finally {
      setBusy(null)
    }
  }

  async function handleClean() {
    if (!file || !report || busy) return
    setError(null)
    setBusy("cleaning")
    try {
      const cleaned = await cleanFile(file, report.fileType)
      setResult({ url: URL.createObjectURL(cleaned.file), name: cleaned.file.name, report: cleaned.report })
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't clean this file.")
    } finally {
      setBusy(null)
    }
  }

  function reset() {
    setFile(null)
    setReport(null)
    setResult(null)
    setError(null)
    if (inputRef.current) inputRef.current.value = ""
  }

  const sensitiveBefore = report?.fields.filter((f) => f.sensitive).length ?? 0
  const sensitiveAfter = result?.report.fields.filter((f) => f.sensitive).length ?? 0

  return (
    <div className="rounded-xl border border-border bg-card p-4 sm:p-6">
      {!file && (
        <label
          htmlFor="metadata-file"
          onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDragging(false)
            const f = e.dataTransfer.files[0]
            if (f) handleFile(f)
          }}
          className={`flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-10 text-center transition-colors ${
            dragging ? "border-primary bg-primary/5" : "border-border hover:border-primary"
          }`}
        >
          <span className="font-semibold">Choose a video or photo</span>
          <span className="mt-1 text-sm text-muted-foreground">or drop it here · MP4, MOV, JPG, PNG, WebP, HEIC · up to 1 GB</span>
          <input
            ref={inputRef}
            id="metadata-file"
            type="file"
            accept={ACCEPT}
            className="sr-only"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) handleFile(f)
            }}
          />
        </label>
      )}

      {busy === "reading" && (
        <p className="mt-4 text-sm text-muted-foreground">
          Reading metadata… The first file takes a few extra seconds while the engine loads.
        </p>
      )}

      {error && <p className="mt-4 rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm">{error}</p>}

      {file && report && (
        <div aria-live="polite">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate font-semibold">{file.name}</p>
              <p className="text-xs text-muted-foreground">{formatBytes(file.size)}</p>
            </div>
            <button
              type="button"
              onClick={reset}
              disabled={busy !== null}
              className="shrink-0 text-xs text-muted-foreground underline hover:text-foreground disabled:opacity-50"
            >
              Choose another file
            </button>
          </div>

          {!result && (
            <>
              <Report report={report} />
              <button
                type="button"
                onClick={handleClean}
                disabled={busy !== null}
                className="mt-6 inline-flex h-11 w-full items-center justify-center rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-60 sm:w-auto"
              >
                {busy === "cleaning" ? "Removing metadata…" : "Remove all metadata"}
              </button>
            </>
          )}

          {result && (
            <div className="space-y-5">
              <div className="rounded-lg border border-border bg-background p-4">
                <p className="text-sm font-semibold">
                  Removed {Math.max(0, report.fields.length - result.report.fields.length)} fields ·{" "}
                  {sensitiveBefore} → {sensitiveAfter} privacy-sensitive
                </p>
                <a
                  href={result.url}
                  download={result.name}
                  className="mt-3 inline-flex h-11 w-full items-center justify-center rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground hover:opacity-90 sm:w-auto"
                >
                  Download clean file
                </a>
                <p className="mt-3 text-xs text-muted-foreground">
                  The picture and sound weren't re-encoded. What's left below is technical information the file
                  needs to open and play correctly (dimensions, codec, duration), plus rotation and colour profile
                  for photos.
                </p>
              </div>
              <p className="text-sm font-semibold">Metadata in the cleaned file</p>
              <Report report={result.report} />
            </div>
          )}
        </div>
      )}
    </div>
  )
}
```

### `app/tools/video-metadata-remover/page.tsx`

```tsx
//app/tools/video-metadata-remover/page.tsx
import type { Metadata } from "next"
import { getTool } from "@/lib/tools/registry"
import { ToolPageShell } from "@/components/tools/tool-page-shell"
import { MetadataCleaner } from "./tool"

const tool = getTool("video-metadata-remover")

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
      intro="See every metadata field in your video or photo (GPS location, device, editing software, dates, encoder and more), then download a copy with all of it removed. Works with MP4, MOV, JPG, PNG, WebP and HEIC, entirely on your device."
      method={
        <>
          <p>
            Phones record the location, device model and date in every video and photo. Editing apps add their
            own name and version, and Adobe apps can add a full editing history. When you send a raw file to a
            client, hire a UGC creator, or share a creative outside your team, all of it travels with the file,
            including GPS coordinates that can point to someone's home.
          </p>
          <p>
            This tool runs <strong>ExifTool</strong>, the open-source standard for reading and writing metadata
            created by Phil Harvey, directly in your browser. It lists every field it finds, grouped by where it's
            stored, and highlights the ones that could identify a person, place, device or workflow.
          </p>
          <p>
            <strong>Removing</strong> deletes every field ExifTool can write, blanks the recording dates in video
            headers, and clears the encoder name stored with the video codec. The picture and sound aren't
            re-encoded, so quality is identical. Afterwards the cleaned file is scanned again, so you can see exactly
            what's left.
          </p>
          <p>
            <strong>What stays on purpose:</strong> technical fields the file needs to open and play (dimensions,
            codec, duration, frame rate), and for photos, the rotation and colour profile, so the picture doesn't
            turn sideways or change colour. None of these identify you.
          </p>
          <p>
            <strong>What this doesn't do:</strong> removing metadata doesn't change how Meta, TikTok or Google review
            your ad, and it doesn't hide an ad or account from their enforcement. Platforms review ads by what's in
            them, not by file tags. Use this for privacy.
          </p>
        </>
      }
      limits={[
        "Some encoders also write their settings inside the compressed video stream itself. Removing that requires re-encoding, which this tool doesn't do.",
        "Timed metadata tracks (used by some drones, dashcams and action cameras for GPS paths) live inside the video stream and can't be removed without re-encoding.",
        "Supports MP4, MOV, JPG, PNG, WebP and HEIC up to 1 GB. Very large videos may run out of memory on phones.",
        "The metadata engine (about 8 MB) downloads the first time you pick a file.",
      ]}
      faqs={[
        {
          q: "Does removing metadata reduce quality?",
          a: "No. The picture and sound data aren't touched or re-encoded. Only the metadata around them is removed.",
        },
        {
          q: "Why are some fields still shown after cleaning?",
          a: "Every video and photo needs some technical information to open at all, like its dimensions, codec and duration. Those fields describe the file, not you. The cleaned report highlights anything privacy-sensitive, and for supported files that should be zero.",
        },
        {
          q: "Don't Facebook and Instagram remove metadata anyway?",
          a: "Independent tests show Meta strips location data from the public copy of uploaded photos, but it receives your original file first. Cleaning the file yourself is the only way to control what leaves your device, including files you send to clients or creators.",
        },
        {
          q: "Will this stop my ads from being rejected or linked to other accounts?",
          a: "No. Ad review looks at what your ad shows and says, and platforms match content by what's in it, not by file metadata. This tool is for privacy, not for getting around platform rules.",
        },
        {
          q: "Is my file uploaded anywhere?",
          a: "No. Everything happens in your browser. You can check: load this page, pick one file so the engine loads, then turn off your internet connection. The tool keeps working.",
        },
      ]}
    >
      <MetadataCleaner />
    </ToolPageShell>
  )
}
```

---

## Appendix F – Verification and troubleshooting commands

### Before every push

```
npx tsc --noEmit
npm run build
```
**Expected:** no type errors; the build's route list shows the four `/tools` routes as `○` (static).

### ROAS calculator (browser)

| Test | Expected |
|---|---|
| Open with defaults | 1.87x, $32.16, $0.64 (break-even); 2.29x, $26.16, $0.52 (target) |
| Product cost 100 | Red box: "Your costs are higher than your price…" |
| Target profit 60 | Red box: "Your target profit is higher than your margin…" |
| DevTools → Network while typing | No new requests |
| Phone | Number keypad appears, cards fit the screen |

### Rejection triage (browser)

| Test | Expected |
|---|---|
| Tick "Says you or your…" + "Promises health results" | Health and wellness, Personal attributes and Misleading claims appear |
| Add "Before-and-after" | Health and wellness moves to the top |
| "Clear all" | Results reset |
| Each "Read Meta's policy →" link | Opens a Meta page |
| DevTools → Network while ticking | No new requests |

### Metadata remover (browser)

| Test | Expected |
|---|---|
| First file picked, DevTools → Network | One request to `/vendor/zeroperl.wasm` (about 7–8 MB transferred), no other domains |
| iPhone video with location on | GPS, device and dates in the amber list; File details show dimensions, duration, codec |
| "Remove all metadata" | "N → 0 privacy-sensitive"; download plays with sound |
| Portrait photo | Stays upright after cleaning |
| Offline after the engine loaded | Cleaning still works |
| Second opinion on a downloaded file | `exiftool -a -G1 yourfile-clean.mp4` shows no GPS, Make, Model, Software or Encoder; header dates `0000:00:00 00:00:00` |

ExifTool on your machine: `brew install exiftool` (Mac), or download from exiftool.org (Windows).

### Deploy checks

- **Vercel build log:** `> node scripts/copy-exiftool-wasm.mjs`, then `Copied ExifTool engine to /vercel/path0/public/vendor/zeroperl.wasm`.
- **If you see `Error: Cannot find module '@6over3/zeroperl-ts/zeroperl.wasm'`:** the dependency is missing from the pushed `package.json` / `package-lock.json`. Run the install command and commit both files.
- **Emergency deploy without the engine:** temporarily remove the `postinstall` line. The metadata tool breaks; nothing else does.

### Commands I ran in my sandbox (not on your machines)

```
git clone https://github.com/mediacrater/test-site-vercel.git
npm ci
npx next build      # with next/font stubbed (sandbox can't reach Google Fonts) and dummy env vars
npm install --save-exact @uswriting/exiftool@1.0.9
node scripts/copy-exiftool-wasm.mjs
# test files with metadata
ffmpeg -f lavfi -i testsrc=size=320x568:rate=30 -f lavfi -i sine=frequency=440 -t 2 -c:v libx264 -c:a aac -metadata title=… -metadata location=… -movflags +use_metadata_tags test.mov
# Pillow script writing EXIF (Make, Model, Software, Artist, Orientation 6, GPS) to test.jpg / test.png / test.webp
npx esbuild libtest.ts --bundle --platform=node --format=esm --external:@uswriting/exiftool --outfile=libtest.mjs && node libtest.mjs
ffmpeg -v error -i out-test.mov -f null -     # full decode check
ffprobe -v error -show_entries format=duration:stream=codec_name -of compact out-test.mp4
```

---

## Appendix G – Rollback and maintenance

### Hide a tool without deleting it

Set its `status` to `"draft"` in `lib/tools/registry.ts` and remove its `<url>` from `public/sitemap.xml`. It disappears from the hub and related-tools links. The URL still works if opened directly. To remove it fully, delete its folder too.

### Remove the metadata engine

1. Delete `app/tools/video-metadata-remover/`, `lib/tools/metadata-cleaner.ts` and `scripts/copy-exiftool-wasm.mjs`.
2. Remove the `postinstall` line, then run `npm uninstall @uswriting/exiftool`.
3. Remove its registry line and sitemap entry.
4. If no other feature uses WebAssembly, remove `'wasm-unsafe-eval'` from `script-src`.

### Upgrading `@uswriting/exiftool`

Upgrade deliberately (`npm install --save-exact @uswriting/exiftool@<version>`, using a version at least two weeks old). Then rerun the metadata browser tests. The `postinstall` script copies the matching engine automatically.

### Routine

- **Every quarter:** recheck Meta policy wording and links in the rejection tool and update `lastVerified` in the registry.
- **Every new tool:** registry line, two files, `live`, sitemap entry, Search Console Request indexing.
- **Watch** Search Console → Performance for `/tools/` pages.

---

*End of index.  
Conversation: (add this chat's link)*
