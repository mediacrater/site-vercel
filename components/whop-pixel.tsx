//components/whop-pixel.tsx
// Whop Pixel (ad attribution). Render this INSIDE <head> in app/layout.tsx.
//
// It is a plain server-rendered <script>, not next/script, so the snippet is
// present in the raw HTML that Whop's installation checker downloads.
// next/script injects inline code after hydration, which a checker that
// doesn't run JavaScript never sees.
//
// The string below is Whop's snippet for biz_vA9rrReKRX6hRu, character for
// character, without the <script> tags (React adds those).
//
// Only rendered when NEXT_PUBLIC_WHOP_PIXEL === "on". Set that on the LIVE
// Vercel project only, so test-site traffic never reaches your Whop data.
// It is read at build time: redeploy after changing it.
const WHOP_SNIPPET = `!function(w,d,s,u,n,a,b){if(w[n])return;a=w[n]={q:[],t:+new Date,s:[],o:u,track:function(){a.q.push([+new Date].concat([].slice.call(arguments)))},setScope:function(){a.s=[].slice.call(arguments).filter(function(x){return typeof x==="string"});a.q.push([+new Date,"setScope"].concat(a.s))},scope:function(){var c=[].slice.call(arguments);return{track:function(){a.q.push([+new Date].concat([].slice.call(arguments)).concat([{__scope:c}]))}}}};b=d.createElement(s);b.async=1;b.src=u+"/s.js";d.getElementsByTagName(s)[0].parentNode.insertBefore(b,d.getElementsByTagName(s)[0])}(window,document,"script","https://t.whop.tw","whop");whop.setScope("biz_vA9rrReKRX6hRu");whop.track("page");`

export function WhopPixel() {
  if (process.env.NEXT_PUBLIC_WHOP_PIXEL !== "on") return null

  return <script id="whop-pixel" dangerouslySetInnerHTML={{ __html: WHOP_SNIPPET }} />
}
