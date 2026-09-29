import { NextRequest, NextResponse } from 'next/server';

const API_BASE_URL =
  process.env.NEXT_PUBLIC_VPS_API_URL ||
  '';

const ALLOWED_PATHS = new Set([
  'resolve-url',
  'scan-video-url',
  'scan-image-url',
]);

async function proxyRequest(
  request: NextRequest,
  context: {
    params:
      | {
          path?: string[];
        }
      | Promise<{
          path?: string[];
        }>;
  }
) {
  if (!API_BASE_URL) {
    return NextResponse.json(
      {
        error:
          'Mediacrater API URL is not configured.',
      },
      {
        status: 500,
      }
    );
  }

  const params =
    await Promise.resolve(
      context.params
    );

  const path =
    (params.path || []).join('/');

  if (!ALLOWED_PATHS.has(path)) {
    return NextResponse.json(
      {
        error:
          'Endpoint not allowed.',
      },
      {
        status: 404,
      }
    );
  }

  const upstreamUrl =
    `${API_BASE_URL.replace(/\/$/, '')}/${path}`;

  const body =
    request.method === 'GET' ||
    request.method === 'HEAD'
      ? undefined
      : await request.text();

  const upstreamResponse =
    await fetch(upstreamUrl, {
      method:
        request.method,
      headers: {
        Authorization:
          request.headers.get(
            'authorization'
          ) || '',
        'Content-Type':
          request.headers.get(
            'content-type'
          ) || 'application/json',
        'x-scan-origin':
          'webapp',
      },
      body,
      cache:
        'no-store',
    });

  const responseText =
    await upstreamResponse.text();

  return new NextResponse(
    responseText,
    {
      status:
        upstreamResponse.status,
      headers: {
        'Content-Type':
          upstreamResponse.headers.get(
            'content-type'
          ) || 'application/json',
      },
    }
  );
}

export async function POST(
  request: NextRequest,
  context: {
    params:
      | {
          path?: string[];
        }
      | Promise<{
          path?: string[];
        }>;
  }
) {
  return proxyRequest(
    request,
    context
  );
}
