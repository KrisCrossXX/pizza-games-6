const HEADER_COOP = 'Cross-Origin-Opener-Policy';
const HEADER_COEP = 'Cross-Origin-Embedder-Policy';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith((async () => {
    const response = await fetch(event.request);
    if (!response || response.type === 'opaque') return response;
    const headers = new Headers(response.headers);
    headers.set(HEADER_COOP, 'same-origin');
    headers.set(HEADER_COEP, 'require-corp');
    if (url.pathname.endsWith('.wasm')) headers.set('Content-Type', 'application/wasm');
    else if (url.pathname.endsWith('.mjs')) headers.set('Content-Type', 'text/javascript; charset=utf-8');
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers
    });
  })());
});
