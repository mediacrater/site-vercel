import { NextRequest, NextResponse } from "next/server"

export const runtime = "nodejs"

// ---------------------------------------------------------------------------
// Rate limiting (in-memory, per-instance)
// ---------------------------------------------------------------------------
// NOTE: This is an in-memory rate limiter. It works correctly as long as
// requests land on the same warm serverless instance, but Vercel can run
// multiple instances of a function concurrently and instances are recycled
// periodically — so under real traffic this limit is "best effort," not a
// hard guarantee. If you need an accurate, durable limit across all
// instances, swap this block out for a shared store like Upstash Redis
// (e.g. @upstash/ratelimit) and keep the rest of this file unchanged.
// ---------------------------------------------------------------------------

const RATE_LIMIT_MAX_REQUESTS = 4
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000 // 60 minutes

type RateLimitEntry = {
  count: number
  windowStart: number
}

// Persist the map across hot invocations on the same instance using a global,
// since module-level state can be reset by bundling/HMR in some environments.
const globalForRateLimit = globalThis as unknown as {
  __customSolutionsRateLimit?: Map<string, RateLimitEntry>
}

const rateLimitStore =
  globalForRateLimit.__customSolutionsRateLimit ?? new Map<string, RateLimitEntry>()
globalForRateLimit.__customSolutionsRateLimit = rateLimitStore

// Periodically clear out stale entries so the map doesn't grow unbounded.
function pruneRateLimitStore(now: number) {
  for (const [key, entry] of rateLimitStore.entries()) {
    if (now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
      rateLimitStore.delete(key)
    }
  }
}

function checkRateLimit(identifier: string): {
  allowed: boolean
  remaining: number
  resetAt: number
} {
  const now = Date.now()
  pruneRateLimitStore(now)

  const existing = rateLimitStore.get(identifier)

  if (!existing || now - existing.windowStart > RATE_LIMIT_WINDOW_MS) {
    rateLimitStore.set(identifier, { count: 1, windowStart: now })
    return {
      allowed: true,
      remaining: RATE_LIMIT_MAX_REQUESTS - 1,
      resetAt: now + RATE_LIMIT_WINDOW_MS,
    }
  }

  if (existing.count >= RATE_LIMIT_MAX_REQUESTS) {
    return {
      allowed: false,
      remaining: 0,
      resetAt: existing.windowStart + RATE_LIMIT_WINDOW_MS,
    }
  }

  existing.count += 1
  return {
    allowed: true,
    remaining: RATE_LIMIT_MAX_REQUESTS - existing.count,
    resetAt: existing.windowStart + RATE_LIMIT_WINDOW_MS,
  }
}

function getClientIp(req: NextRequest): string {
  // Vercel populates x-forwarded-for with the client IP first in the list.
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

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const VOLUME_OPTIONS = new Set([
  "",
  "under-100",
  "100-500",
  "500-2000",
  "2000-plus",
  "platform",
])

const VOLUME_LABELS: Record<string, string> = {
  "under-100": "Under 100 creatives",
  "100-500": "100 – 500",
  "500-2000": "500 – 2,000",
  "2000-plus": "2,000+",
  platform: "Platform / very high volume",
}

type FormPayload = {
  name: string
  email: string
  company: string
  volume: string
  message: string
}

function isValidEmail(email: string): boolean {
  // Simple, pragmatic email check — not exhaustive RFC 5322 validation.
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

function validatePayload(body: unknown): { valid: true; data: FormPayload } | { valid: false; error: string } {
  if (typeof body !== "object" || body === null) {
    return { valid: false, error: "Invalid request body." }
  }

  const { name, email, company, volume, message } = body as Record<string, unknown>

  if (typeof name !== "string" || name.trim().length === 0) {
    return { valid: false, error: "Name is required." }
  }
  if (name.length > 200) {
    return { valid: false, error: "Name is too long." }
  }

  if (typeof email !== "string" || email.trim().length === 0) {
    return { valid: false, error: "Email is required." }
  }
  if (email.length > 320 || !isValidEmail(email.trim())) {
    return { valid: false, error: "Please provide a valid email address." }
  }

  if (company !== undefined && typeof company !== "string") {
    return { valid: false, error: "Invalid company value." }
  }
  if (typeof company === "string" && company.length > 200) {
    return { valid: false, error: "Company name is too long." }
  }

  if (volume !== undefined && typeof volume !== "string") {
    return { valid: false, error: "Invalid volume value." }
  }
  if (typeof volume === "string" && !VOLUME_OPTIONS.has(volume)) {
    return { valid: false, error: "Invalid volume selection." }
  }

  if (message !== undefined && typeof message !== "string") {
    return { valid: false, error: "Invalid message value." }
  }
  if (typeof message === "string" && message.length > 5000) {
    return { valid: false, error: "Message is too long." }
  }

  return {
    valid: true,
    data: {
      name: name.trim(),
      email: email.trim(),
      company: typeof company === "string" ? company.trim() : "",
      volume: typeof volume === "string" ? volume : "",
      message: typeof message === "string" ? message.trim() : "",
    },
  }
}

// ---------------------------------------------------------------------------
// Slack formatting
// ---------------------------------------------------------------------------

function escapeForSlack(text: string): string {
  // Slack's mrkdwn uses &, <, > as special characters.
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
}

function buildSlackPayload(data: FormPayload) {
  const volumeLabel = data.volume ? VOLUME_LABELS[data.volume] ?? data.volume : "Not specified"

  const fields = [
    { type: "mrkdwn", text: `*Name:*\n${escapeForSlack(data.name)}` },
    { type: "mrkdwn", text: `*Email:*\n${escapeForSlack(data.email)}` },
    { type: "mrkdwn", text: `*Company:*\n${data.company ? escapeForSlack(data.company) : "—"}` },
    { type: "mrkdwn", text: `*Volume:*\n${escapeForSlack(volumeLabel)}` },
  ]

  const blocks: Record<string, unknown>[] = [
    {
      type: "header",
      text: { type: "plain_text", text: "New custom solutions inquiry", emoji: true },
    },
    { type: "section", fields },
  ]

  if (data.message) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: `*Message:*\n${escapeForSlack(data.message)}` },
    })
  }

  blocks.push({ type: "divider" })

  return {
    text: `New custom solutions inquiry from ${data.name} (${data.email})`,
    blocks,
  }
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function POST(req: NextRequest) {
  const ip = getClientIp(req)

  const rateLimit = checkRateLimit(ip)
  if (!rateLimit.allowed) {
    const retryAfterSeconds = Math.max(0, Math.ceil((rateLimit.resetAt - Date.now()) / 1000))
    return NextResponse.json(
      { error: "Too many requests. Please try again later." },
      {
        status: 429,
        headers: {
          "Retry-After": String(retryAfterSeconds),
          "X-RateLimit-Limit": String(RATE_LIMIT_MAX_REQUESTS),
          "X-RateLimit-Remaining": "0",
        },
      }
    )
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 })
  }

  const validation = validatePayload(body)
  if (!validation.valid) {
    return NextResponse.json({ error: validation.error }, { status: 400 })
  }

  const webhookUrl = process.env.SLACK_FORM_WEBHOOK_URL
  if (!webhookUrl) {
    console.error("SLACK_FORM_WEBHOOK_URL is not set.")
    return NextResponse.json(
      { error: "Server is not configured to accept submissions right now." },
      { status: 500 }
    )
  }

  try {
    const slackResponse = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildSlackPayload(validation.data)),
    })

    if (!slackResponse.ok) {
      const responseText = await slackResponse.text().catch(() => "")
      console.error("Slack webhook responded with an error:", slackResponse.status, responseText)
      return NextResponse.json(
        { error: "Failed to send your message. Please try again." },
        { status: 502 }
      )
    }
  } catch (err) {
    console.error("Failed to reach Slack webhook:", err)
    return NextResponse.json(
      { error: "Failed to send your message. Please try again." },
      { status: 502 }
    )
  }

  return NextResponse.json(
    { success: true },
    {
      status: 200,
      headers: {
        "X-RateLimit-Limit": String(RATE_LIMIT_MAX_REQUESTS),
        "X-RateLimit-Remaining": String(rateLimit.remaining),
      },
    }
  )
}
