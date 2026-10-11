// あなたはウィキペディア中毒でしょうかテスト：オフライン対応の Service Worker
//
// 方針
//   HTML・CSS・JS  … ネットワーク優先（更新がすぐ反映される）。つながらないときだけキャッシュ
//   質問・回答 JSON … キャッシュ優先で即表示し、裏で取り直して中身が正しければ更新
//   画像など       … キャッシュがあればそれを返し、裏で更新（stale-while-revalidate）
//   それ以外の通信（アクセス解析・POST など）には手を出さない
//
// 公開する中身を変えたら CACHE_NAME を上げる（古いキャッシュは activate で消える）

const CACHE_NAME = "jawpctest2.3.0-q2-a2";

const URLS_TO_CACHE = [
  "./",
  "./index.html",
  "./shusei.html",
  "./kaito.html",
  "./data/questions/2.json",
  "./data/answers/2.json",
  "./offline.html",
  "./assets/quiz.css",
  "./assets/img/icon-192.png",
  "../favicon.ico"
];

// 共通スタイル nanona-ui（別オリジン）。取得できなくてもインストールは止めない
const NANONA_UI_ORIGIN = "https://ui.nanona.me";
const OPTIONAL_URLS = [
  NANONA_UI_ORIGIN + "/v1/nanona.css",
  NANONA_UI_ORIGIN + "/v1/nanona.js"
];

const OFFLINE_URL = "./offline.html";

/* ---------- インストール・有効化 ---------- */

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    // HTTP キャッシュを通さず最新を取る
    await cache.addAll(URLS_TO_CACHE.map((url) => new Request(url, { cache: "reload" })));
    await Promise.all(OPTIONAL_URLS.map((url) =>
      cache.add(new Request(url, { mode: "cors", cache: "reload" })).catch(() => {})
    ));
    // 新しい版をすぐ有効にする（HTML はネットワーク優先なので、古いページと混ざる心配は小さい）
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((name) => name !== CACHE_NAME).map((name) => caches.delete(name)));
    // 開いているページもすぐこの版の管理下に置く
    await self.clients.claim();
  })());
});

/* ---------- 取得 ---------- */

// 保存してよい応答か（エラー・リダイレクト・中身の見えない応答は保存しない）
function isCacheable(response) {
  return response && response.ok && (response.type === "basic" || response.type === "cors");
}

async function putInCache(request, response) {
  if (!isCacheable(response)) return;
  const cache = await caches.open(CACHE_NAME);
  await cache.put(request, response);
}

// ネットワーク優先。つながらなければキャッシュ、それも無ければ fallback
async function networkFirst(request, { ignoreSearch = false, fallback } = {}) {
  try {
    const response = await fetch(request);
    putInCache(request, response.clone());
    return response;
  } catch (err) {
    const cached = await caches.match(request, { ignoreSearch });
    if (cached) return cached;
    if (fallback) {
      const page = await caches.match(fallback);
      if (page) return page;
    }
    return Response.error();
  }
}

// キャッシュがあればすぐ返し、裏で取り直す
async function staleWhileRevalidate(event, validate) {
  const request = event.request;
  const cached = await caches.match(request);
  const update = fetch(request).then(async (response) => {
    if (!validate || (await validate(response.clone()))) putInCache(request, response.clone());
    return response;
  });
  if (cached) {
    event.waitUntil(update.catch(() => {}));
    return cached;
  }
  return update.catch(() => Response.error());
}

// 質問・回答 JSON は、空でない配列のときだけ保存する（壊れたデータでキャッシュを上書きしない）
async function isValidQuizJson(response) {
  if (!response.ok) return false;
  try {
    const data = await response.json();
    return Array.isArray(data) && data.length > 0;
  } catch (err) {
    return false;
  }
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  const sameOrigin = url.origin === self.location.origin;
  const isNanonaUi = url.origin === NANONA_UI_ORIGIN;
  // アクセス解析・外部画像などはブラウザに任せる
  if (!sameOrigin && !isNanonaUi) return;

  // ページ（?kaito= や ?pwa=1 付きでも、オフライン時は同じページのキャッシュを返す）
  if (request.mode === "navigate" || (request.headers.get("accept") || "").includes("text/html")) {
    event.respondWith(networkFirst(request, { ignoreSearch: true, fallback: OFFLINE_URL }));
    return;
  }

  // 質問・回答データ
  if (sameOrigin && /\/data\/(questions|answers)\/[^/]+\.json$/.test(url.pathname)) {
    event.respondWith(staleWhileRevalidate(event, isValidQuizJson));
    return;
  }

  // CSS・JS（自サイトと nanona-ui）・manifest.json など
  if (/\.(css|js|json)$/.test(url.pathname)) {
    event.respondWith(networkFirst(request));
    return;
  }

  // 画像など
  event.respondWith(staleWhileRevalidate(event));
});
