//components/google-tag.tsx
// Google tag (gtag.js) for Google Ads, ID AW-16650524214.
// Render this INSIDE <head> in app/layout.tsx.
//
// Same two scripts as Google's snippet, with ONE addition: a Consent Mode
// default of "denied" before the config call (Quebec Law 25 expects opt-in).
// Until a consent banner calls gtag('consent', 'update', ...) with "granted",
// Google measures conversions without cookies, so reporting is limited.
// To skip the denied default, delete the gtag('consent', 'default', ...) call
// below, but only if you have another lawful basis for the cookies.
//
// Only rendered when NEXT_PUBLIC_GOOGLE_TAG === "on". Set that on the LIVE
// Vercel project only, so test-site traffic never reaches Google Ads.
// It is read at build time: redeploy after changing it.
const GOOGLE_TAG_ID = "AW-16650524214"

const INIT = `window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('consent', 'default', {
  ad_storage: 'denied',
  ad_user_data: 'denied',
  ad_personalization: 'denied',
  analytics_storage: 'denied',
  wait_for_update: 500
});
gtag('js', new Date());

gtag('config', '${GOOGLE_TAG_ID}');`

export function GoogleTag() {
  if (process.env.NEXT_PUBLIC_GOOGLE_TAG !== "on") return null

  return (
    <>
      <script async src={`https://www.googletagmanager.com/gtag/js?id=${GOOGLE_TAG_ID}`} />
      <script id="google-tag-init" dangerouslySetInnerHTML={{ __html: INIT }} />
    </>
  )
}
