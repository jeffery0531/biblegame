/*
 * 离线缓存。
 * 第一次联网打开时把全部文件存到本机；之后先用本机的副本（所以没网也能玩），
 * 有网时在后台悄悄更新，下次打开就是新版本。
 * 新增了文件（比如新的图片、脚本）要记得加进下面的 ASSETS。
 */
const CACHE = 'biblegame-v1';
const ASSETS = [
  './',
  'index.html',
  'css/style.css',
  'js/data.js',
  'js/app.js',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE)
      .then(function (cache) { return cache.addAll(ASSETS); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (event) {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;

  const answer = caches.open(CACHE).then(function (cache) {
    return cache.match(req, { ignoreSearch: true }).then(function (hit) {
      const refresh = fetch(req.url, { cache: 'no-cache' })
        .then(function (res) {
          if (res && res.ok) cache.put(req.url, res.clone());
          return res;
        })
        .catch(function () {
          return hit || (req.mode === 'navigate' ? cache.match('index.html') : undefined);
        });
      event.waitUntil(refresh);
      return hit || refresh;
    });
  });
  event.respondWith(answer);
});
