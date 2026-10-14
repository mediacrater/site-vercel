# Results Page Player: Italic Refresh Note and "Why do we do this?" Link to the Privacy Policy

| | |
|---|---|
| **Date** | 14 October 2026 (`14oct26`) |
| **Destination** | changelogs/site |
| **Conversation** | Not available to me. Paste this chat's URL here when you file this. |
| **Related prior work** | `results-video-player-with-violation-timeline-14oct26.md`<br>`results-player-volume-slider-14oct26.md`<br>`privacy-policy-results-player-and-frames-bullet-14oct26.md`<br>`privacy-policy-scan-metadata-wording-14oct26.md` |
| **Stack** | Next.js web app on Vercel (`components/video-timeline.tsx` only) |
| **Starting trigger** | You wanted users warned that refreshing ends video playback, in italics, with a link to the privacy policy that opens in a new tab |

> **Redaction note:** No secrets, keys, IP addresses, user IDs or email addresses are included. `VPS_IPV4`, `VPS_IPV6`, `<customer uuid>`, `<your test account uuid>` and similar placeholders stand in for them. Real accounts are described by what happened, not by ID.

**How to read the status marks in this file:** ✅ = done and you reported or verified it. ⚠️ = advised, but I can't confirm it was applied (an expected output is given). ⏳ = open.

---

## Contents

1. [Summary](#1-summary)
2. [Status at a glance](#2-status-at-a-glance)
3. [Starting point](#3-starting-point)
4. [Timeline: what we did, in order](#4-timeline-what-we-did-in-order)
5. [Errors and surprises](#5-errors-and-surprises)
6. [Corrections / important decisions](#6-corrections--important-decisions)
7. [Open items checklist](#7-open-items-checklist)
8. [Reference: key settings](#8-reference-key-settings)
9. [Appendix A – The note as on main](#appendix-a--the-note-as-on-main)
10. [Appendix B – Test checklist and expected results](#appendix-b--test-checklist-and-expected-results)
11. [Appendix C – Rollback](#appendix-c--rollback)

---

## 1. Summary

A short italic note now sits directly under the player controls, followed by a "Why do we do this? ↗" link to `/privacy` that opens in a **new tab**.

**Main outcomes**

- The note says refreshing loses video playback features and that scan results persist until the tab is closed or "New Scan" is clicked.
- The link uses `target="_blank"` with `rel="noopener noreferrer"`, so the new tab can't reach the original page through `window.opener`.
- **Wording:** your first version said results persist "until you click New Scan". I pointed out that closing the tab also clears them (sessionStorage, and free users have no history), and the version on `main` includes "close this tab or".
- `&quot;` is used for the quotes in JSX text.
- I checked that `app/privacy/page.tsx` exists, so the link resolves. It did **not** yet explain the player or the frames (see `privacy-policy-results-player-and-frames-bullet-14oct26.md`).

---

## 2. Status at a glance

| Area | Status | Notes |
|---|---|---|
| Note and link in `video-timeline.tsx` | ✅ Done | On `main`, with your wording including "close this tab" |
| `/privacy` route exists | ✅ Verified | `app/privacy/page.tsx` found in the repo |
| New-tab behaviour and styling in the browser | ⚠️ Not reported | Appendix B. Expected results are listed |
| The privacy page explains the player and frames | ⏳ Not done | See `privacy-policy-results-player-and-frames-bullet-14oct26.md` |
| Copied to the live web repo | ✅ Done | You reported the web app files were copied. I haven't seen the live repo |

---

## 3. Starting point

- After a refresh the player is gone (the original file is only in memory), while results and thumbnails remain (sessionStorage).
- Without a note, users could think the whole result was lost.

---

## 4. Timeline: what we did in order

### Phase 1 – The first note

You wrote the note text yourself and asked for the italic styling plus the link.

### Phase 2 – My checks

I fetched the repo's `app` folder (the `/privacy` route exists) and then read the privacy page to see whether it supports the link. It didn't mention the player or frames, which produced the next change file.

### Phase 3 – Wording

I suggested ending with "or close this tab", and the repo now has it.

---

## 5. Errors and surprises

| # | What happened | Cause | Resolution |
|---|---|---|---|
| 1 | "Results persist until New Scan" was slightly untrue | Closing the tab also clears them | Wording now includes "close this tab" |
| 2 | The "Why do we do this?" link lands on a page that doesn't answer it | The policy only covers server-side deletion of files | Open item in `privacy-policy-results-player-and-frames-bullet-14oct26.md` |

---

## 6. Corrections / important decisions

### Corrections to my own advice

1. I said the note would otherwise make users think everything is lost. I offered an optional sentence ("Your results and frames are kept"). It was not added, which is fine.

### Decisions

1. Italic muted text under the controls.
2. A plain `<a>` with a new tab, not a Next `Link`.
3. Link target `/privacy` (not `/chrome-extension-privacy`, which is the extension's page).

### Known limits

- The note is always shown, even on a first view where a refresh isn't relevant.
- The link is only useful once the policy covers the player and frames.

---

## 7. Open items checklist

- [x] Note and link added
- [x] Wording includes the tab-close case
- [x] Copied to the live web repo (you reported it)
- [ ] Add the privacy-policy bullet (`privacy-policy-results-player-and-frames-bullet-14oct26.md`) so the link lands on an explanation
- [ ] Run the Appendix B checklist

---

## 8. Reference: key settings

| Item | Value |
|---|---|
| File | `components/video-timeline.tsx` (last element of the component) |
| Link | `href="/privacy"`, `target="_blank"`, `rel="noopener noreferrer"` |
| Classes | `text-xs italic text-muted-foreground`, link `font-medium underline underline-offset-2 hover:text-foreground` |

---

## Appendix A – The note as on main

```tsx
      <p className="text-xs italic text-muted-foreground">
        Refreshing the page after receiving your results will result in loss of video playback features and cannot be recovered. Scan results below will persist until you close this tab or click &quot;New Scan&quot; in the top right.{' '}
        <a
          href="/privacy"
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium underline underline-offset-2 hover:text-foreground"
        >
          Why do we do this? ↗
        </a>
      </p>
    </div>
```

---

## Appendix B – Test checklist and expected results

| Check | Expected result |
|---|---|
| Look under the player controls | Italic note, then an underlined "Why do we do this? ↗" |
| Click the link | `/privacy` opens in a new tab. The original tab keeps its results and player |
| Tab to the link and press Enter | Same result, with a visible focus ring |
| Dark mode and phone width | Readable, wraps normally |

---

## Appendix C – Rollback

Delete the `<p>` block shown in Appendix A.

---

*End of index.*
