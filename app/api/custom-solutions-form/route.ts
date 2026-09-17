import { NextRequest, NextResponse } from "next/server"
import { supabase } from "@/lib/mediacrater/supabaseClient"

export const runtime = "nodejs"

// ---------------------------------------------------------------------------
// Rate limiting (Supabase-backed, atomic via RPC)
// ---------------------------------------------------------------------------
// The actual count-check-and-log happens inside a single Postgres function
// (check_and_log_form_attempt), called via supabase.rpc(). This avoids the
// race conditions and per-instance drift that an in-memory rate limiter has
// on serverless: every invocation, on every instance, reads and writes the
// same table, and the check + insert happen atomically in one DB round trip.
// ---------------------------------------------------------------------------

const RATE_LIMIT_MAX_REQUESTS = 4
const RATE_LIMIT_WINDOW_MINUTES = 60

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

async function checkRateLimit(ip: string): Promise<{ allowed: boolean; error?: string }> {
  const { data, error } = await supabase.rpc("check_and_log_form_attempt", {
    p_ip: ip,
    p_user_id: null,
    p_max_attempts: RATE_LIMIT_MAX_REQUESTS,
    p_window_minutes: RATE_LIMIT_WINDOW_MINUTES,
  })

  if (error) {
    console.error("Rate limit RPC error:", error)
    return { allowed: false, error: error.message }
  }

  return { allowed: data === true }
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

  const rateLimit = await checkRateLimit(ip)
  if (!rateLimit.allowed) {
    if (rateLimit.error) {
      // The RPC itself failed (e.g. permissions, connectivity) rather than
      // the limit being legitimately hit. Fail closed but return a generic
      // message — don't leak internal error details to the client.
      return NextResponse.json(
        { error: "Something went wrong. Please try again." },
        { status: 500 }
      )
    }

    return NextResponse.json(
      { error: "Too many requests. Please try again later." },
      {
        status: 429,
        headers: {
          "Retry-After": String(RATE_LIMIT_WINDOW_MINUTES * 60),
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

  return NextResponse.json({ success: true }, { status: 200 })
}
