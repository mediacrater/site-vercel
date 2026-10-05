// middleware.ts
import { NextRequest, NextResponse } from 'next/server';
import { attachDeviceCookie, readOrMintDeviceId } from '@/lib/account-device';

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|images).*)',
  ],
};

export function middleware(req: NextRequest) {
  // 1. Origin-secret check (blocks direct *.vercel.app access)
  const secret = process.env.CLOUDFLARE_PROXY_SECRET;
  if (secret && req.headers.get('x-mediacrater-proxy-secret') !== secret) {
    if (req.nextUrl.pathname.startsWith('/api/')) {
      return new NextResponse('Forbidden', { status: 403 });
    }
  }

  // 2. Device cookie
  const { deviceId, minted } = readOrMintDeviceId(req);
  const res = NextResponse.next();
  if (minted) {
    attachDeviceCookie(res, deviceId);
  }
  return res;
}
