'use client';

import { useEffect } from 'react';

const API_ORIGIN = process.env.NEXT_PUBLIC_VPS_API_URL;
// if NEXT_PUBLIC_API_URL is the full API root, that's fine:
const CF_OK = `${String(API_ORIGIN).replace(/\/$/, '')}/cf-ok`;

export function ApiHostClearance() {
  useEffect(() => {
    const warm = () => {
      let iframe = document.getElementById('mc-cf-ok') as HTMLIFrameElement | null;
      if (!iframe) {
        iframe = document.createElement('iframe');
        iframe.id = 'mc-cf-ok';
        iframe.title = 'cf-ok';
        iframe.style.cssText =
          'position:absolute;width:0;height:0;border:0;visibility:hidden';
        document.body.appendChild(iframe);
      }
      iframe.src = `${CF_OK}?t=${Date.now()}`;
    };

    warm();
    const id = setInterval(warm, 45_000); // keep Bot Fight window from going cold
    return () => clearInterval(id);
  }, []);

  return null;
}
