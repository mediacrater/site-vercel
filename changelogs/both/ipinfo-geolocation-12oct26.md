# IP Geolocation: Anonymous IPinfo API Found, Token Added on the VPS, Alternatives Reviewed

| | |
|---|---|
| **Date** | 12 October 2026 (`12oct26`) |
| **Conversation** | https://claude.ai/chat/d4b23f41-e563-40d3-a5ba-165fd98c9a36 |
| **Related prior work** | `auth-hardening-turnstile-supabase-origin-secret-05oct26.md` (5 Oct 2026, `lib/account-device.ts` and `account_devices`) |
| **Related work (same conversation)** | `google-oauth-signin-12oct26.md` (the VPS port `routes/_shared/accountDevice.js` uses the same lookup) |
| **Stack** | Vercel (`lib/account-device.ts`, used by `/api/signup` and `/api/signin`), VPS (`routes/_shared/accountDevice.js`, used by `/api/oauth/complete`), IPinfo |
| **Starting trigger** | While discussing costs, I listed IPinfo's limits. You said you had no IPinfo account, yet city names appeared in Supabase, so you assumed "it's something else" |

> **Redaction note:** No secrets, keys, IP addresses, user IDs or email addresses are included. `YOUR_TOKEN` is a placeholder.

**How to read the status marks in this file:** ✅ = done and you reported or verified it. ⚠️ = advised, but I can't confirm it was applied. ⏳ = open.

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
9. [Appendix A – Monitoring and setup commands](#appendix-a--monitoring-and-setup-commands)

---

## 1. Summary

It **is** IPinfo, used without an account. Both lookup helpers choose an endpoint like this:

```ts
const token = process.env.IPINFO_TOKEN;
const url = token
  ? `https://ipinfo.io/${encodeURIComponent(ip)}?token=${encodeURIComponent(token)}`
  : `https://ipinfo.io/${encodeURIComponent(ip)}/json`;
```

With no token, that's IPinfo's **anonymous public API**, which includes city data. It's limited to **1,000 requests per day, shared by everyone using the same IP address**. On Vercel, that means sharing with other Vercel customers on the same server IPs. When the shared limit is used up, lookups fail **silently**: signups still work, but country, city, network provider and VPN/hosting flags are saved as NULL, which weakens abuse detection.

**Main outcomes**

- You created a free IPinfo account and set `IPINFO_TOKEN` in the **VPS** `.env`. The dashboard showed requests from the Google flow (`/complete`).
- With a token, the same endpoint becomes the Legacy Free API: **50,000 requests per month**, for you alone, still with city. No code change needed.
- **Vercel was not updated** (your decision): email signup and sign-in still use the anonymous API, since you plan to move those routes to the VPS.
- Alternatives reviewed and declined for now: a self-hosted DB-IP database on the VPS, and Cloudflare's own location data.

---

## 2. Status at a glance

| Area | Status | Notes |
|---|---|---|
| Free IPinfo account | ✅ Created | |
| `IPINFO_TOKEN` in test VPS `.env` | ✅ Done | Dashboard showed 1 request after a Google sign-in |
| `IPINFO_TOKEN` in prod VPS `.env` | ✅ Done | Part of the Google production rollout |
| `IPINFO_TOKEN` on Vercel | ⏳ Not set | Your decision (routes moving to the VPS) |
| Token works on the legacy endpoint (city included) | ⚠️ Not checked | `curl` in [Appendix A](#appendix-a--monitoring-and-setup-commands) |
| Monitoring for silent failures | ⚠️ Advised | Query in Appendix A |
| Self-hosted geolocation (DB-IP) | ⏳ Declined for now | Accuracy concern (city) |
| Cloudflare location headers + local ASN | ⏳ Declined for now | You'll keep the current setup |

---

## 3. Starting point

- `lib/account-device.ts` (Vercel) takes the country from `cf-ipcountry` / `x-vercel-ip-country`, and the city **only** from IPinfo (line 120: "Vercel's city header describes the edge, so city comes from ipinfo only").
- The VPS port (`routes/_shared/accountDevice.js`) uses the same endpoint logic, and takes the country from the Worker's trusted `x-mc-client-country`.
- VPN and hosting flags come from the network provider's name (regex), not from IPinfo's paid privacy data.
- Your privacy policy discloses a "network intelligence provider".

---

## 4. Timeline: what we did, in order

### Phase 1 – Cost question

I listed IPinfo as the first limit you'd likely hit, and assumed you used the Legacy Free API (50k per month with a token).

### Phase 2 – "I don't have an IPinfo account"

I found the no-token branch in both helpers: the anonymous public API, limited to 1,000 per day **per source IP, shared with everyone on it**. That's especially fragile on Vercel.

### Phase 3 – Options

| Option | Data | Limit | Change |
|---|---|---|---|
| 1. Free account, legacy endpoint | city, country, ASN | 50,000 / month, yours | Set `IPINFO_TOKEN` only |
| 2. IPinfo Lite | country + ASN (no city) | Unlimited; attribution for public use | Small code change |
| 3. Self-hosted DB-IP Lite (City + ASN) on the VPS | City (accuracy index 77 vs 96 commercial), country, ASN | Unlimited, monthly updates, CC BY 4.0 (link to DB-IP required) | Lookup module, updater, internal endpoint for Vercel |
| 4. Cloudflare location headers (Managed Transform "Add visitor location headers") + Worker `request.cf` + local DB-IP ASN | City/country from Cloudflare, ASN local | Unlimited, no third party | Bigger change |

You objected to the accuracy loss in option 3. I clarified that the loss is mainly **city**; country and ASN (which your VPN and hosting detection uses) are reliable in free data, and option 4 avoids it. **You chose to keep things as they are for now.**

### Phase 4 – Token on the VPS only

"Will an account give slightly more requests?" Yes: 50,000 per month of your own versus a shared 1,000 per day, and the main gain is reliability. You set the token on the VPS. The Google flow's lookup showed in the dashboard. Email routes on Vercel still use the anonymous API (they don't appear in your dashboard). I advised setting it on Vercel as a server-only variable (no `NEXT_PUBLIC_` prefix); you deferred, since those routes are moving to the VPS.

---

## 5. Errors and surprises

| # | What happened | Cause | Resolution |
|---|---|---|---|
| 1 | City data without an account | The no-token branch uses IPinfo's anonymous API | Explained |
| 2 | I told you earlier to copy "the same `IPINFO_TOKEN` as on Vercel" | I assumed a token existed | Corrected: free account created |
| 3 | The Google flow "worked" without the token on Vercel | Only the VPS calls IPinfo during Google sign-in | Explained: email routes are still anonymous |

---

## 6. Corrections / important decisions

### Corrections to my own advice

1. **I assumed you had an IPinfo token** (in the Google rollout steps and the cost answer).

### Decisions

1. **Keep IPinfo for now:** token on the VPS, anonymous on Vercel until the routes move.
2. **Self-hosted or Cloudflare-based geolocation deferred.**

---

## 7. Open items checklist

- [ ] Run the monitoring query every so often. If `missing_location` climbs, set `IPINFO_TOKEN` on Vercel (server-only), then redeploy
- [ ] Check the token returns a city on the legacy endpoint (`curl` below)
- [ ] When moving `/api/signup` and `/api/signin` to the VPS, they'll use the VPS token automatically
- [ ] Optional later: option 4 (Cloudflare location + local ASN), then remove "network intelligence provider" from the privacy policy and add the DB-IP credit

---

## 8. Reference: key settings

| Item | Value |
|---|---|
| Env var | `IPINFO_TOKEN` (server-only; **never** `NEXT_PUBLIC_`) |
| With token | `https://ipinfo.io/<ip>?token=…`: Legacy Free API, 50,000 / month, includes city |
| Without token | `https://ipinfo.io/<ip>/json`: 1,000 / day, shared per source IP |
| Lite endpoint (not used) | `https://api.ipinfo.io/lite/<ip>?token=…`: unlimited, country + ASN, attribution for public use |
| Lookup timeout | 1.5 s; on failure, the intel fields are NULL and signup continues |
| Where it's set | Test VPS ✅, prod VPS ✅, Vercel ⏳ |

---

## Appendix A – Monitoring and setup commands

**Check the token works (city included):**
```bash
curl -s "https://ipinfo.io/8.8.8.8?token=YOUR_TOKEN"
```
Expected: JSON that includes `"city"`.

**Silent-failure monitor (Supabase SQL Editor):**
```sql
select date_trunc('day', created_at) as day,
       count(*) as devices,
       count(*) filter (where country is null) as missing_location
from public.account_devices
where created_at > now() - interval '30 days'
group by 1 order by 1 desc;
```
Expected: `missing_location` near 0. Rising values mean the anonymous limit is being hit (Vercel routes).

**Set it on Vercel (when you choose to):** Project → Settings → Environment Variables → `IPINFO_TOKEN` (Production and test), then redeploy. One email signup should increase the dashboard's request count.

---

*End of index.  
Conversation: `<add this conversation's URL>`*
