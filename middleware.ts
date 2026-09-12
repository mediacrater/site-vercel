// middleware.ts (optional)
// Mints mc_device_id on the first page view so the cookie already exists
// before /api/signup. If you skip this file, the signup route still mints
// the cookie on the POST — you only miss linking a signup to an earlier visit.
//
// Merge with your existing Supabase middleware if you have one: read/mint
// the device cookie on the same NextResponse you already return.

import { NextRequest, NextResponse } from 'next/server';
import { attachDeviceCookie, readOrMintDeviceId } from '@/lib/account-device';

export function middleware(req: NextRequest) {
  const { deviceId, minted } = readOrMintDeviceId(req);
  const res = NextResponse.next();
  if (minted) attachDeviceCookie(res, deviceId);
  return res;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|images|api/resend-verification).*)'],
};
