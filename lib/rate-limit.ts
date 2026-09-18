import { NextRequest } from "next/server"
import { createClient } from "@supabase/supabase-js"

// ---------------------------------------------------------------------------
// Shared rate limiting (Supabase-backed, atomic via RPC) + Turnstile
// verification, used across signup, signin, reset-password, and
// resend-verification.
//
// Table: rate_limits (action, ip, user_id, created_at)
// RPC:   check_and_log_rate_limit(p_action, p_ip, p_user_id,
//                                  p_max_attempts, p_window_seconds)
//        returns (allowed boolean, retry_after_seconds int)
//
// user_id is always passed as null from every current call site: none of
// signup/signin/reset-password/resend-verification run behind an
// authenticated session at the point the check happens. The column and
// parameter are kept for future endpoints that do run behind auth.
// ---------------------------------------------------------------------------

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export type RateLimitAction = "signup" | "signin" | "reset_password" | "resend_verification" | "solutions_form"

export type RateLimitResult = {
  allowed: boolean
  retryAfterSeconds: number
  error?: string
}

export async function checkAndLogRateLimit(
  action: RateLimitAction,
  ip: string,
  maxAttempts: number,
  windowSeconds: number
): Promise<RateLimitResult> {
  try {
    const { data, error } = await supabaseAdmin
      .rpc("check_and_log_rate_limit", {
        p_action: action,
        p_ip: ip,
        p_user_id: null,
        p_max_attempts: maxAttempts,
        p_window_seconds: windowSeconds,
      })
      .single()

    if (error) {
      console.error(
        `[RATE LIMIT] RPC error for action "${action}":`,
        error.message
      )

      return {
        allowed: false,
        retryAfterSeconds: windowSeconds,
        error: error.message,
      }
    }

    if (
      !data ||
      typeof data.allowed !== "boolean" ||
      !Number.isInteger(data.retry_after_seconds) ||
      data.retry_after_seconds < 0 ||
      (!data.allowed && data.retry_after_seconds < 1)
    ) {
      console.error(
        `[RATE LIMIT] Invalid RPC response for action "${action}".`
      )

      return {
        allowed: false,
        retryAfterSeconds: windowSeconds,
        error: "Invalid rate limit response.",
      }
    }

    return {
      allowed: data.allowed,
      retryAfterSeconds: data.retry_after_seconds,
    }
  } catch (error) {
    console.error(
      `[RATE LIMIT] Request failed for action "${action}":`,
      error
    )

    return {
      allowed: false,
      retryAfterSeconds: windowSeconds,
      error: "Rate limit request failed.",
    }
  }
}

export function clientIpFrom(req: NextRequest): string {
  const forwardedFor = req.headers.get("x-forwarded-for")
  if (forwardedFor) {
    return forwardedFor.split(",")[0].trim()
  }
  const realIp = req.headers.get("x-real-ip")
  if (realIp) {
    return realIp.trim()
  }
  return "unknown"
}

const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify"

export async function verifyTurnstileToken(
  token: string | undefined | null,
  ip: string
): Promise<boolean> {
  if (!token) return false

  const secretKey = process.env.TURNSTILE_SECRET_KEY
  if (!secretKey) {
    console.error("TURNSTILE_SECRET_KEY is not set.")
    return false
  }

  try {
    const params = new URLSearchParams()
    params.append("secret", secretKey)
    params.append("response", token)
    if (ip && ip !== "unknown") {
      params.append("remoteip", ip)
    }

    const res = await fetch(TURNSTILE_VERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
    })

    if (!res.ok) {
      console.error("Turnstile siteverify HTTP error:", res.status)
      return false
    }

    const result = (await res.json()) as { success: boolean; [key: string]: unknown }
    if (!result.success) {
      console.error("Turnstile verification failed:", result)
    }
    return result.success === true
  } catch (err) {
    console.error("Failed to reach Turnstile siteverify:", err)
    return false
  }
}
