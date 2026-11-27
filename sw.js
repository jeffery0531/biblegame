/*
 * 离线缓存（整套更新）。
 *
 * 平板上永远存着一整套完整的游戏文件，没有网络也能打开。
 * 联网打开时会在后台把每个文件重新取一遍，和存着的逐个比对；只要有一个变了，
 * 就把新的一整套另存成新版本，下一次打开时整套换过去。
 * 所以不会出现「页面是新的、脚本还是旧的」这种半新半旧的情况：
 * 中途断网、有文件没取到，就什么都不换，继续用原来那一套。
 *
 * 发布新内容不用改这个文件。只有新增了文件（新的图片、脚本）时，
 * 要把它加进下面的 ASSETS，这样第一次安装就会把它存下来。
 */
const ASSETS = [
  './',
  'index.html',
  'css/style.css',
  'js/data.js',
  'js/runner.js',
  'js/app.js',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png'
];

const FILES = 'bg66-files-';     // 每个版本一个缓存：bg66-files-<时间戳>
const META = 'bg66-meta';        // 记着现在用的是哪个版本
const LEGACY = 'biblegame-v1';   // 最早那一版的缓存，换过来之后删掉

function abs(path) { return new URL(path, self.registration.scope).href; }
const OK_URL = abs('__complete__');     // 缓存里有这个记号，才算整套都存好了
const ACTIVE_URL = abs('__active__');

let active = null;       // 现在用的版本（服务线程被系统回收后会重新读）
let building = null;     // 正在写入的版本，别把它当垃圾删了
let lastCheck = 0;
let checking = false;

function wait(ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); }

function sameBytes(a, b) {
  if (a.byteLength !== b.byteLength) return false;
  const x = new Uint8Array(a);
  const y = new Uint8Array(b);
  for (let i = 0; i < x.length; i++) {
    if (x[i] !== y[i]) return false;
  }
  return true;
}

// 所有已经完整存好的版本，旧的在前、新的在后
async function completeVersions() {
  const names = (await caches.keys()).filter(function (n) { return n.indexOf(FILES) === 0; });
  const done = [];
  for (const name of names) {
    const cache = await caches.open(name);
    if (await cache.match(OK_URL)) done.push(name);
  }
  return done.sort();
}

async function readActive() {
  if (active) return active;
  const meta = await caches.open(META);
  const saved = await meta.match(ACTIVE_URL);
  if (saved) {
    const name = await saved.text();
    if (await caches.has(name)) {
      active = name;
      return active;
    }
  }
  return promote();
}

// 换到最新的完整版本，并清掉其余的。只在「打开页面」的那一刻做，
// 这样同一个页面用到的文件一定都来自同一个版本
async function promote() {
  const done = await completeVersions();
  if (!done.length) return null;
  const newest = done[done.length - 1];
  if (newest !== active) {
    const meta = await caches.open(META);
    await meta.put(ACTIVE_URL, new Response(newest));
    active = newest;
  }
  const all = await caches.keys();
  await Promise.all(all.filter(function (n) {
    return n === LEGACY || (n.indexOf(FILES) === 0 && n !== newest && n !== building);
  }).map(function (n) { return caches.delete(n); }));
  return active;
}

// 把一整套文件存成一个新版本；最后才写上「完整」的记号
async function store(urls, responses) {
  const name = FILES + Date.now();
  building = name;
  try {
    const cache = await caches.open(name);
    await Promise.all(urls.map(function (u, i) { return cache.put(u, responses[i]); }));
    await cache.put(OK_URL, new Response('ok'));
  } finally {
    building = null;
  }
  return name;
}

async function fetchFresh(url) {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(url + ' -> ' + res.status);
  return res;
}

async function checkForUpdate() {
  const current = await readActive();
  if (!current) return;
  const cache = await caches.open(current);
  const wanted = ASSETS.map(abs);

  // 清单里的文件必须全部取到；有一个失败就整个作罢
  const urls = wanted.slice();
  const fresh = await Promise.all(wanted.map(fetchFresh));

  // 清单之外、之前玩的时候顺手存下来的文件也带上；这些取不到就算了
  const keys = await cache.keys();
  for (const key of keys) {
    if (key.url === OK_URL || wanted.indexOf(key.url) !== -1) continue;
    try {
      fresh.push(await fetchFresh(key.url));
      urls.push(key.url);
    } catch (e) { /* 这个文件大概已经不用了 */ }
  }

  let changed = urls.length !== keys.length - 1;
  for (let i = 0; i < urls.length && !changed; i++) {
    const old = await cache.match(urls[i]);
    if (!old) { changed = true; break; }
    const a = await fresh[i].clone().arrayBuffer();
    const b = await old.arrayBuffer();
    if (!sameBytes(a, b)) changed = true;
  }
  if (!changed) return;

  await store(urls, fresh);
  const clients = await self.clients.matchAll();
  clients.forEach(function (c) { c.postMessage({ type: 'update-ready' }); });
}

// 页面打开后稍等一下再查，别和页面自己加载文件抢网络；刚查过就不重复查
async function checkSoon() {
  await wait(1500);
  if (checking || Date.now() - lastCheck < 15000) return;
  checking = true;
  lastCheck = Date.now();
  try {
    await checkForUpdate();
  } catch (e) {
    lastCheck = 0;      // 没网或者没取全：下次打开再试
  } finally {
    checking = false;
  }
}

async function respond(request) {
  const nav = request.mode === 'navigate';
  const name = nav ? ((await promote()) || (await readActive())) : await readActive();
  let cache = null;
  if (name) {
    cache = await caches.open(name);
    const hit = (await cache.match(request, { ignoreSearch: true })) ||
      (nav ? await cache.match(abs('index.html')) : undefined);
    if (hit) return hit;
  }
  // 清单里没有的文件：走网络，取到了顺手存一份，下次没网也有
  const res = await fetch(request);
  if (cache && res && res.ok && res.type === 'basic') cache.put(request, res.clone());
  return res;
}

self.addEventListener('install', function (event) {
  event.waitUntil((async function () {
    const urls = ASSETS.map(abs);
    const fresh = await Promise.all(urls.map(fetchFresh));
    await store(urls, fresh);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', function (event) {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', function (event) {
  const request = event.request;
  // 只管游戏自己这个文件夹里的 GET 请求，同一个网站下别的路径一律不碰
  if (request.method !== 'GET' || request.url.indexOf(self.registration.scope) !== 0) return;
  if (request.mode === 'navigate') event.waitUntil(checkSoon());
  event.respondWith(respond(request));
});
