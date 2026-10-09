// app/api/signin/route.ts
//
// CHANGES (password policy): a successful sign-in now also returns
// weakPassword: true when the password doesn't meet the current rules
// (lib/password-policy.ts), e.g. accounts created under the old 6-character
// minimum. Sign-in still succeeds; the page shows a gentle "please update"
// prompt. Supabase's own weak-password flag counts too (it can also include
// reasons such as a leaked password, if that protection is enabled).
import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@supabase/supabase-js"
import { checkAndLogRateLimit, clientIpFrom } from "@/lib/rate-limit"
import { isPasswordValid } from "@/lib/password-policy"

const supabaseAnon = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

const SIGNIN_MAX_ATTEMPTS = 8
const SIGNIN_WINDOW_SECONDS = 120

export async function POST(req: NextRequest) {
  const { email, password, turnstileToken } = await req.json()

  if (!email || !password) {
    return NextResponse.json(
      { error: "Email and password are required." },
      { status: 400 }
    )
  }

  // Supabase verifies the token itself (it is single-use), so we only check it exists.
  if (!turnstileToken) {
    return NextResponse.json(
      { error: "Verification failed. Please try again." },
      { status: 400 }
    )
  }

  const ip = clientIpFrom(req)

  const rateLimit = await checkAndLogRateLimit(
    "signin",
    ip,
    SIGNIN_MAX_ATTEMPTS,
    SIGNIN_WINDOW_SECONDS
  )

  const rateLimitHeaders = {
    "X-RateLimit-Action": "signin",
    "X-RateLimit-Limit": String(SIGNIN_MAX_ATTEMPTS),
  }

  if (rateLimit.error) {
    return NextResponse.json(
      { error: "Something went wrong. Please try again." },
      { status: 500, headers: rateLimitHeaders }
    )
  }

  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Too many sign-in attempts. Please try again shortly." },
      {
        status: 429,
        headers: {
          ...rateLimitHeaders,
          "Retry-After": String(rateLimit.retryAfterSeconds),
          "X-RateLimit-Remaining": "0",
        },
      }
    )
  }

  const { data, error } = await supabaseAnon.auth.signInWithPassword({
    email,
    password,
    options: { captchaToken: turnstileToken },
  })

  if (error) {
    if (/captcha/i.test(error.message)) {
      return NextResponse.json(
        { error: "Verification failed. Please try again." },
        { status: 400, headers: rateLimitHeaders }
      )
    }
    return NextResponse.json(
      { error: error.message },
      { status: 400, headers: rateLimitHeaders }
    )
  }

  const supabaseFlaggedWeak = Boolean((data as { weakPassword?: unknown }).weakPassword)

  return NextResponse.json(
    {
      success: true,
      session: data.session,
      weakPassword: supabaseFlaggedWeak || !isPasswordValid(password),
    },
    { headers: rateLimitHeaders }
  )
}
