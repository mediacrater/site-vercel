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

import { NextRequest, NextResponse } from 'next/server';
import { clientIpFrom } from '@/lib/rate-limit';

const MAX_BODY_BYTES = 16 * 1024;
const MAX_REPORTS_PER_REQUEST = 20;
const PER_IP_PER_MINUTE = 60;

// Best effort only: serverless instances don't share memory.
const recentByIp = new Map<string, { windowStart: number; count: number }>();

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
    return clean(url.origin + url.pathname);
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
    for (const r of normalize(payload)) {
      console.warn(
        `[CSP] ${r.disposition || 'report'} | directive:${r.directive} | blocked:${r.blocked} | page:${r.page}` +
          (r.source ? ` | source:${r.source}:${r.line}` : '')
      );
    }
  }

  // 204 either way, so the browser doesn't retry.
  return new NextResponse(null, { status: 204 });
}
