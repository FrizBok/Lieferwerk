'use strict';
/* Lieferwerk Service Worker
 * - App-Dateien: zuerst Netzwerk (immer aktuell), offline aus dem Cache
 * - Lesende API-Abfragen fuer Packen/Touren: zuerst Netzwerk, offline die zuletzt geladenen Daten (nur lesen)
 * - Schreibende Anfragen werden nie gepuffert; offline erscheint eine Fehlermeldung
 * - Beim Abmelden raeumt die App den API-Cache (Nachricht "clear-api") */
const SHELL = 'lw-shell-v2';
const API = 'lw-api-v1';
const SHELL_FILES = ['/', '/style.css', '/core.js', '/pages-admin.js', '/pages-work.js', '/pages-plan.js', '/pwa.js', '/live.js', '/app.js',
  '/favicon.svg', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png'];
const API_CACHEABLE = /^\/api\/(me|pack\/orders(\/\d+)?|driver\/orders)$/;

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL);
    await Promise.all(SHELL_FILES.map((f) => cache.add(f).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== SHELL && k !== API) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'clear-api') event.waitUntil(caches.delete(API));
});

async function networkFirst(req, cacheName, markCached) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(req, { ignoreSearch: false });
    if (!hit) throw err;
    if (!markCached) return hit;
    const headers = new Headers(hit.headers);
    headers.set('X-Lw-Cache', '1');
    return new Response(await hit.blob(), { status: hit.status, statusText: hit.statusText, headers });
  }
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) {
    if (API_CACHEABLE.test(url.pathname)) event.respondWith(networkFirst(req, API, true));
    return;
  }
  if (url.pathname === '/sw.js') return;
  if (req.mode === 'navigate') {
    event.respondWith(networkFirst(new Request('/'), SHELL, false));
    return;
  }
  event.respondWith(networkFirst(req, SHELL, false));
});
