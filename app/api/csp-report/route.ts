// app/api/csp-report/route.ts
//
// PHASE 2: receives Content Security Policy violation reports and writes a
// one-line summary of each to the Vercel logs (search for "[CSP]").
//
// Abuse limits: anyone can POST here, so bodies are capped at 16 KB, at most
// 20 reports are read per request, every logged value is length-capped and
// stripped of control characters, URLs lose their query string and fragment
// (they can carry tokens), and each server instance logs at most 60 requests
// per IP per minute. Nothing is written to the database.
//
// Slack (optional): Vercel's Hobby plan keeps runtime logs for about an hour,
// so reports would disappear before anyone reads them. If
// CSP_SLACK_WEBHOOK_URL is set, each distinct violation is also posted to
// Slack: at most once per hour per server instance (keyed on directive,
// blocked URL and page path), at most 10 messages per minute per instance,
// and never for browser-extension sources.

import { NextRequest, NextResponse } from 'next/server';
import { clientIpFrom } from '@/lib/rate-limit';

const MAX_BODY_BYTES = 16 * 1024;
const MAX_REPORTS_PER_REQUEST = 20;
const PER_IP_PER_MINUTE = 60;

// Best effort only: serverless instances don't share memory.
const recentByIp = new Map<string, { windowStart: number; count: number }>();

const SLACK_WEBHOOK_URL = process.env.CSP_SLACK_WEBHOOK_URL || '';
const SLACK_DEDUPE_MS = 60 * 60 * 1000;
const SLACK_MAX_PER_MINUTE = 10;
const slackSentAt = new Map<string, number>();
let slackWindowStart = 0;
let slackWindowCount = 0;

const EXTENSION_SCHEME = /^(chrome|moz|safari-web|ms-browser)-extension:/i;

function isExtensionNoise(r: Normalized): boolean {
  return EXTENSION_SCHEME.test(r.blocked) || EXTENSION_SCHEME.test(r.source);
}

// Slack treats <, > and & as markup (links, @channel mentions).
function slackEscape(value: string): string {
  return value.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c] as string));
}

function takeSlackSlot(key: string): boolean {
  const now = Date.now();

  const last = slackSentAt.get(key);
  if (last && now - last < SLACK_DEDUPE_MS) return false;

  if (now - slackWindowStart >= 60_000) {
    slackWindowStart = now;
    slackWindowCount = 0;
  }
  if (slackWindowCount >= SLACK_MAX_PER_MINUTE) return false;

  slackWindowCount += 1;
  if (slackSentAt.size > 1_000) slackSentAt.clear();
  slackSentAt.set(key, now);
  return true;
}

function pagePath(page: string): string {
  try {
    return new URL(page).pathname;
  } catch {
    return page;
  }
}

async function notifySlack(lines: string[]): Promise<void> {
  if (!SLACK_WEBHOOK_URL || lines.length === 0) return;
  try {
    // Awaited (with a short timeout) because a serverless function can be
    // frozen as soon as the response is sent.
    await fetch(SLACK_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: lines.join('\n') }),
      signal: AbortSignal.timeout(3_000),
    });
  } catch (error) {
    console.error(`${process.env.NEXT_PUBLIC_STATE} [CSP] Slack notification failed:`, error instanceof Error ? error.message : error);
  }
}

function allowLog(ip: string): boolean {
  const now = Date.now();
  const entry = recentByIp.get(ip);
  if (!entry || now - entry.windowStart > 60_000) {
    if (recentByIp.size > 5_000) recentByIp.clear();
    recentByIp.set(ip, { windowStart: now, count: 1 });
    return true;
  }
  entry.count += 1;
  return entry.count <= PER_IP_PER_MINUTE;
}

function clean(value: unknown, maxLength = 200): string {
  return String(value ?? '')
    .slice(0, maxLength)
    .replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, ' ');
}

// Keeps origin + path only: query strings and fragments can hold tokens.
function cleanUrl(value: unknown): string {
  const raw = String(value ?? '');
  try {
    const url = new URL(raw);
    // Extension URLs (chrome-extension://…) have an opaque "null" origin.
    const base = url.origin !== 'null' ? url.origin : `${url.protocol}//${url.host}`;
    return clean(base + url.pathname);
  } catch {
    return clean(raw.split(/[?#]/)[0]); // keywords like "inline", "eval", "data"
  }
}

type Normalized = {
  directive: string;
  blocked: string;
  page: string;
  source: string;
  line: string;
  disposition: string;
};

// Handles both formats: the older report-uri body ({"csp-report": {...}},
// application/csp-report) and the Reporting API array
// ([{type: "csp-violation", body: {...}}], application/reports+json).
function normalize(payload: unknown): Normalized[] {
  const items: Record<string, unknown>[] = [];

  if (Array.isArray(payload)) {
    for (const entry of payload.slice(0, MAX_REPORTS_PER_REQUEST)) {
      const body = (entry as { body?: unknown })?.body;
      if (body && typeof body === 'object') items.push(body as Record<string, unknown>);
    }
  } else if (payload && typeof payload === 'object') {
    const legacy = (payload as Record<string, unknown>)['csp-report'];
    if (legacy && typeof legacy === 'object') items.push(legacy as Record<string, unknown>);
  }

  return items.map((r) => ({
    directive: clean(r['effective-directive'] ?? r.effectiveDirective ?? r['violated-directive'], 60),
    blocked: cleanUrl(r['blocked-uri'] ?? r.blockedURL),
    page: cleanUrl(r['document-uri'] ?? r.documentURL),
    source: cleanUrl(r['source-file'] ?? r.sourceFile),
    line: clean(r['line-number'] ?? r.lineNumber, 10),
    disposition: clean(r.disposition, 20),
  }));
}

export async function POST(req: NextRequest) {
  const declaredLength = Number(req.headers.get('content-length') || 0);
  if (declaredLength > MAX_BODY_BYTES) {
    return new NextResponse(null, { status: 413 });
  }

  let text: string;
  try {
    text = await req.text();
  } catch {
    return new NextResponse(null, { status: 400 });
  }
  if (text.length > MAX_BODY_BYTES) {
    return new NextResponse(null, { status: 413 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    return new NextResponse(null, { status: 400 });
  }

  if (allowLog(clientIpFrom(req) || 'unknown')) {
    const slackLines: string[] = [];

    for (const r of normalize(payload)) {
      const line =
        `${process.env.NEXT_PUBLIC_STATE} [CSP] ${r.disposition || 'report'} | directive:${r.directive} | blocked:${r.blocked} | page:${r.page}` +
        (r.source ? ` | source:${r.source}:${r.line}` : '');
      console.warn(line);

      if (!isExtensionNoise(r) && takeSlackSlot(`${r.directive}|${r.blocked}|${pagePath(r.page)}`)) {
        slackLines.push(slackEscape(line));
      }
    }

    await notifySlack(slackLines);
  }

  // 204 either way, so the browser doesn't retry.
  return new NextResponse(null, { status: 204 });
}
