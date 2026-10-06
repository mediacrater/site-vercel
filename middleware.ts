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
    const got = req.headers.get('x-mediacrater-proxy-secret');
    if (!secret) {
      if (process.env.VERCEL_ENV === 'production') {
        console.error('[MW] CLOUDFLARE_PROXY_SECRET not set in this deployment');
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
    } else if (got !== secret) {
      console.error('[MW] proxy secret rejected', { headerPresent: got !== null });
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
  }

  const { deviceId, minted } = readOrMintDeviceId(req);
  const res = NextResponse.next();
  if (minted) attachDeviceCookie(res, deviceId);
  return res;
}
