/* SmashStats Web — Service Worker（Phase 1）
   アプリの殻（HTML/CSS/JS・マニフェスト・アイコン）だけをキャッシュする。
   試合データはキャッシュしない。IndexedDB（smashstats-web）が正。 */
'use strict';
const CACHE_NAME = 'smashstats-shell-v6'; // 版を上げると全端末の殻が新しいものに入れ替わる
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon-180.png',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return cache.addAll(SHELL);
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE_NAME; })
        .map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (event) {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return; // 外部リクエストは触らない
  event.respondWith(
    caches.match(event.request).then(function (cached) {
      if (cached) return cached;
      return fetch(event.request).then(function (res) {
        // 同一オリジンの殻ファイルだけをキャッシュへ追加する
        if (res && res.ok && SHELL.some(function (p) { return url.pathname.endsWith(p.replace('./', '')); })) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then(function (cache) { cache.put(event.request, copy); });
        }
        return res;
      }).catch(function () {
        if (event.request.mode === 'navigate') return caches.match('./index.html');
        throw new Error('offline');
      });
    })
  );
});
