// Cache-first service worker so the game works offline after the first visit.
const CACHE = 'raintown-v1';
const FILES = ['./', './index.html', './css/style.css', './manifest.webmanifest',
  './js/main.js', './js/world.js', './js/enemies.js', './js/player.js', './js/input.js', './js/audio.js', './js/story.js', './js/util.js',
  './vendor/three.module.js', './vendor/GLTFLoader.js', './vendor/BufferGeometryUtils.js', './vendor/SkeletonUtils.js',
  './assets/village.glb', './assets/nature.glb', './assets/soldier.glb', './icons/icon-180.png', './icons/icon-192.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', e => { if (e.request.method !== 'GET') return; e.respondWith(caches.match(e.request).then(r => r || fetch(e.request).then(res => { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); return res; }))); });
