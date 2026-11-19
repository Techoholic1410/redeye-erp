// Works from any sub-path (e.g. GitHub Pages /redeye-erp/): all URLs are relative to the SW scope.
const CACHE = 'redeye-erp-v6';
const SHELL = ['./', 'app.js', 'data.js', 'entities.js', 'config.js', 'style.css', 'manifest.webmanifest', 'icons/icon-192.png'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL))); self.skipWaiting(); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
// App shell: network first, fall back to cache (so it still opens offline). Supabase API calls are never cached.
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin) return;
  e.respondWith(fetch(e.request).then((r) => { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); return r; })
    .catch(() => caches.match(e.request).then((m) => m || caches.match('./'))));
});
self.addEventListener('push', (e) => {
  let d = {}; try { d = e.data.json(); } catch {}
  e.waitUntil(Promise.all([
    self.registration.showNotification(d.title || 'Redeye ERP', { body: d.body || '', icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', data: { url: d.url || '#/' } }),
    self.clients.matchAll({ type: 'window' }).then((cs) => cs.forEach((c) => c.postMessage({ type: 'refresh-notifications' }))),
  ]));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = self.registration.scope + (e.notification.data?.url || '#/');
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((cs) => {
    for (const c of cs) if ('focus' in c) { c.navigate(url); return c.focus(); }
    return self.clients.openWindow(url);
  }));
});
