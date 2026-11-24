'use strict';
// Service worker wersji webowej: po pierwszej wizycie generator i strona odbioru działają bez internetu.
// Nazwa pamięci zawiera wersję aplikacji – nowe wydanie podmienia pliki (sprawdza to test).
const CACHE = 'qr-1.0.1';
const FILES = [
  './', 'index.html', 'odbior.html', 'styles.css', 'manifest.webmanifest',
  'app.js', 'rx.js', 'odbior.js', 'qr.js', 'ui.js', 'icons.js', 'platform.js',
  'core/base45.js', 'core/fountain.js', 'core/transfer.js', 'core/content.js',
  'vendor/jsQR.js', 'vendor/qrcode-generator.js', 'vendor/capacitor.js',
  'fonts/inter-latin-wght-normal.woff2', 'fonts/inter-latin-ext-wght-normal.woff2',
  'assets/icon-192.png', 'assets/icon-180.png', 'assets/icon-512.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

// Najpierw sieć (świeża wersja), bez sieci – pamięć podręczna. Część adresu po „#” nigdy tu nie trafia.
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: true }).then((r) => r || caches.match('index.html')))
  );
});
