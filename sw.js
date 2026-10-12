// Măsura — service worker: aplicația rulează complet offline după prima deschidere.
// La fiecare versiune nouă, schimbă VERSION.
const VERSION = 'masura-v1.6.2';
const ASSETS = [
  './',
  './index.html',
  './css/app.css',
  './js/app.js',
  './js/engine.js',
  './js/store.js',
  './js/play.js',
  './js/mqtt.js',
  './js/share.js',
  './js/monitor.js',
  './monitor.html',
  './manifest.webmanifest',
];
// iconițele se cachează dacă există, dar lipsa lor nu blochează instalarea offline
const OPTIONAL = ['./icon-192.png', './icon-512.png', './apple-touch-icon.png'];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(VERSION)
      // cache: 'reload' = ia fișierele direct de pe server, nu din cache-ul vechi al telefonului
      .then(c => c.addAll(ASSETS.map(u => new Request(u, { cache: 'reload' })))
        .then(() => Promise.all(OPTIONAL.map(u => c.add(new Request(u, { cache: 'reload' })).catch(() => {})))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  if (req.mode === 'navigate') {
    // pagina cerută (index sau monitor); dacă nu e în cache, încercăm rețeaua, apoi index-ul
    e.respondWith(
      caches.match(req, { ignoreSearch: true })
        .then(r => r || fetch(req).catch(() => caches.match('./index.html')))
    );
    return;
  }
  e.respondWith(caches.match(req, { ignoreSearch: true }).then(r => r || fetch(req)));
});
