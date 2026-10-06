// middleware.ts
import { NextRequest, NextResponse } from 'next/server';
import { attachDeviceCookie, readOrMintDeviceId } from '@/lib/account-device';

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|images).*)',
  ],
};

export function middleware(req: NextRequest) {
  const secret = process.env.CLOUDFLARE_PROXY_SECRET;

  if (req.nextUrl.pathname.startsWith('/api/')) {
    const misconfigured = !secret && process.env.VERCEL_ENV === 'production';
    if (misconfigured || (secret && req.headers.get('x-mediacrater-proxy-secret') !== secret)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
  }

  const { deviceId, minted } = readOrMintDeviceId(req);
  const res = NextResponse.next();
  if (minted) attachDeviceCookie(res, deviceId);
  return res;
}
