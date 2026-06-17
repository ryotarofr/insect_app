/* KOCHŪ Service Worker
 * 軽量 PWA: アプリシェル + フォントの offline cache。
 * - 戦略:
 *   - same-origin HTML/JS/CSS/画像: stale-while-revalidate
 *   - fonts.googleapis.com / fonts.gstatic.com: cache-first (長期)
 *   - それ以外 (将来の API 等): network-first フォールバックで cache miss
 * - バージョンを変更すると古いキャッシュが即座に削除されます。
 */
const VERSION = "kochu-v1";
const APP_SHELL = `${VERSION}-shell`;
const FONTS = `${VERSION}-fonts`;
const RUNTIME = `${VERSION}-runtime`;

// Vite dev のビルド成果物ハッシュは変わるため、初回訪問時に実 URL を fetch で拾う。
// ここでは最低限のルート + マニフェストだけ pre-cache する。
const PRECACHE_URLS = [
  "/",
  "/manifest.webmanifest",
  "/favicon.svg",
  "/icon-192.png",
  "/icon-512.png",
  "/icon-maskable-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(APP_SHELL);
      // precache ベストエフォート (失敗してもインストールは続行)
      await Promise.all(
        PRECACHE_URLS.map((url) =>
          cache.add(url).catch((err) => console.warn("[sw] precache miss", url, err))
        )
      );
      self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => !k.startsWith(VERSION))
          .map((k) => caches.delete(k))
      );
      await self.clients.claim();
    })()
  );
});

const isFontReq = (url) =>
  url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com";

const isAsset = (url) =>
  url.origin === self.location.origin &&
  /\.(?:js|css|png|svg|webmanifest|ico|woff2?)$/.test(url.pathname);

const isNavigation = (req) =>
  req.mode === "navigate" || (req.method === "GET" && req.headers.get("accept")?.includes("text/html"));

async function staleWhileRevalidate(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  const networkPromise = fetch(req)
    .then((res) => {
      if (res && res.ok) cache.put(req, res.clone());
      return res;
    })
    .catch(() => null);
  return cached || (await networkPromise) || Response.error();
}

async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  if (cached) return cached;
  try {
    const res = await fetch(req);
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  } catch {
    return cached || Response.error();
  }
}

async function networkFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(req);
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  } catch {
    const cached = await cache.match(req);
    if (cached) return cached;
    // ナビゲーションフォールバック: ルート / を返す
    if (isNavigation(req)) {
      const shell = await cache.match("/");
      if (shell) return shell;
    }
    return Response.error();
  }
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // Chrome extension などはスキップ
  if (url.protocol !== "http:" && url.protocol !== "https:") return;

  if (isFontReq(url)) {
    event.respondWith(cacheFirst(req, FONTS));
    return;
  }

  if (isNavigation(req)) {
    // App shell: network-first でルート / にフォールバック
    event.respondWith(networkFirst(req, APP_SHELL));
    return;
  }

  if (isAsset(url)) {
    event.respondWith(staleWhileRevalidate(req, APP_SHELL));
    return;
  }

  // その他の same-origin GET (将来の /api 等): network-first
  if (url.origin === self.location.origin) {
    event.respondWith(networkFirst(req, RUNTIME));
  }
});

// Background Sync のスタブ — Phase 2 で queue を実装予定
self.addEventListener("sync", (event) => {
  if (event.tag === "kochu-log-sync") {
    // TODO: drain IndexedDB queue (P2-xx)
    console.info("[sw] background sync requested:", event.tag);
  }
});

// メッセージングでキャッシュ即時更新 (開発時のデバッグ用)
self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});
