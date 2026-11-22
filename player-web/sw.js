const CACHE = 'lain-player-v1';
const FILES = [
  './index.html', './styles.css', './app.js', './manifest.webmanifest',
  './assets/icons/cross-192.png', './assets/icons/cross-512.png',
  './assets/icons/lain-512.png', './assets/icons/brown-512.png',
  './assets/wallpaper/default.jpg', './assets/wallpaper/1.jpg', './assets/wallpaper/2.jpg'
];
self.addEventListener('install', e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(caches.match(e.request).then(r => r || fetch(e.request).then(res => {
    const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return res;
  })));
});
