/* 성과상여금 도우미 서비스 워커
 * - 앱 파일만 미리 캐시(precache)하고 캐시 우선으로 제공 → 오프라인 동작
 * - 사용자 자료(엑셀·PDF)는 브라우저 메모리에서만 다루므로 캐시 대상이 아님
 * - 목록에 없는 주소는 손대지 않음 (PRD 10.5)
 */
const APP_VERSION = '1.0.0';
const CACHE_PREFIX = 'bonus-helper-';
const CACHE = CACHE_PREFIX + 'v' + APP_VERSION;
const APP_FILES = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-512.png'
];
const APP_URLS = new Set(APP_FILES.map(f => new URL(f, self.registration.scope).href));

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(APP_FILES.map(f => new Request(f, { cache: 'reload' }))))
  );
  // 새 버전은 사용자가 [새로고침]을 누를 때까지 대기 (작업 중 자료 보호)
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith(CACHE_PREFIX) && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  url.search = '';
  url.hash = '';
  if (!APP_URLS.has(url.href)) return;
  event.respondWith(
    caches.open(CACHE)
      .then(cache => cache.match(url.href))
      .then(hit => hit || fetch(req))
  );
});
