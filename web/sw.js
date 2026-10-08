// Service worker viết tay của Ví nhà. vite.config.ts chèn danh sách app shell và mã phiên bản lúc build.
//  - App shell: precache, trả từ cache trước (mở app không cần mạng).
//  - GET /v1/*: bản lưu còn "tươi" (freshFor, ADR-69: 30 giây cho số, 5 phút cho cấu hình) thì trả luôn, không hỏi mạng;
//    hết hạn, hoặc app gửi header x-no-cache (người dùng bấm tải lại) thì mạng trước. Mất mạng thì trả bản lưu gần nhất,
//    gắn header x-sw-cached-at để app ghi "số lúc HH:mm". Bản trả khi còn tươi bỏ header này: số đó không cũ.
//  - Yêu cầu ghi (POST/PATCH/PUT/DELETE) tới /v1/* không bao giờ đi qua cache, và xoá sạch cache API trước lẫn sau khi
//    gửi — màn hình đọc lại sau khi ghi luôn lấy số mới. Hàng đợi IndexedDB của app lo phần offline.
//  - Đường của Worker (bypassWorker: /webhooks/*, /mcp, /oauth/*, /oauth.css, /.well-known/*) không đụng tới — trang
//    uỷ quyền Claude phải tới Worker, không được trả app shell.
//  - Thông báo đẩy: hiện tin server gửi, bấm vào thì mở đúng màn; subscription đổi thì tự đăng ký lại.

const VERSION = "__VERSION__";
const SHELL = `vi-nha-shell-${VERSION}`;
const API = "vi-nha-api";
const FONTS = "vi-nha-fonts";
const PRECACHE = __PRECACHE__;

/* __FRESH_FOR__ */

// Tăng mỗi lần xoá cache API: GET bắt đầu trước lần xoá thì không được ghi kết quả (có thể là số trước khi ghi) vào cache.
let generation = 0;

async function invalidateApi() {
  generation++;
  await caches.delete(API);
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

// Bản mới kích hoạt (VERSION đổi): bỏ app shell cũ và cả cache API — số lưu từ bản trước có thể mang dạng dữ liệu cũ
// (vd. tên trường trước khi đổi sang tiếng Anh) mà code mới không đọc được (pwa UC-710 AC-11).
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("vi-nha-shell-") && k !== SHELL).map((k) => caches.delete(k))))
      .then(() => invalidateApi())
      .then(() => self.clients.claim()),
  );
});

async function apiGet(request) {
  const fresh = request.headers.get("x-no-cache") ? 0 : freshFor(new URL(request.url).pathname);
  if (fresh > 0) {
    const hit = await (await caches.open(API)).match(request);
    const age = hit ? Date.now() - Date.parse(hit.headers.get("x-sw-cached-at") ?? "") : NaN;
    if (hit && age >= 0 && age < fresh) {
      const headers = new Headers(hit.headers);
      headers.delete("x-sw-cached-at");
      return new Response(hit.body, { status: hit.status, statusText: hit.statusText, headers });
    }
  }
  const started = generation;
  try {
    const response = await fetch(request);
    if (response.status === 200) {
      const headers = new Headers(response.headers);
      headers.set("x-sw-cached-at", new Date().toISOString());
      const body = await response.clone().arrayBuffer();
      if (started === generation) await (await caches.open(API)).put(request, new Response(body, { status: 200, statusText: "OK", headers }));
    } else if (response.status === 401) {
      // Phiên hết hạn: đừng để bản lưu cũ giả vờ là vẫn đăng nhập.
      await invalidateApi();
    }
    return response;
  } catch (err) {
    const cached = await (await caches.open(API)).match(request);
    if (cached) return cached;
    throw err;
  }
}

async function apiWrite(request) {
  await invalidateApi();
  try {
    return await fetch(request);
  } finally {
    // GET chạy song song với yêu cầu ghi có thể đã lưu số trước khi ghi: xoá lần nữa trước khi app đọc lại.
    await invalidateApi();
  }
}

async function shellCacheFirst(request) {
  const cache = await caches.open(SHELL);
  const hit = await cache.match(request, { ignoreSearch: request.mode === "navigate" });
  if (hit) return hit;
  try {
    return await fetch(request);
  } catch (err) {
    // Điều hướng tới một đường dẫn lạ khi mất mạng: SPA nên trả trang gốc.
    if (request.mode === "navigate") {
      const index = await cache.match("/");
      if (index) return index;
    }
    throw err;
  }
}

async function fontsCacheFirst(request) {
  const cache = await caches.open(FONTS);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok || response.type === "opaque") await cache.put(request, response.clone());
  return response;
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET") {
    if (url.origin === self.location.origin && url.pathname.startsWith("/v1/")) event.respondWith(apiWrite(request));
    return;
  }

  if (url.origin === self.location.origin) {
    if (url.pathname.startsWith("/v1/")) return event.respondWith(apiGet(request));
    if (bypassWorker(url.pathname)) return;
    if (request.mode === "navigate") return event.respondWith(shellCacheFirst(new Request("/")));
    return event.respondWith(shellCacheFirst(request));
  }
  if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") {
    event.respondWith(fontsCacheFirst(request));
  }
});

// ── Thông báo đẩy ──────────────────────────────────────────────────
// Server gửi JSON { title, body, url, tag }. Mọi push PHẢI hiện thông báo (iOS thu hồi quyền nếu không).

self.addEventListener("push", (event) => {
  let msg = {};
  if (event.data) {
    try {
      const parsed = event.data.json();
      msg = parsed && typeof parsed === "object" ? parsed : { body: String(parsed) };
    } catch {
      msg = { body: event.data.text() };
    }
  }
  const title = typeof msg.title === "string" && msg.title ? msg.title : "Ví nhà";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: typeof msg.body === "string" ? msg.body : "",
      tag: typeof msg.tag === "string" && msg.tag ? msg.tag : undefined,
      data: { url: typeof msg.url === "string" && msg.url ? msg.url : "/" },
      icon: "/icons/icon-192.png",
    }),
  );
});

async function openApp(url) {
  const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  const client = windows.find((c) => new URL(c.url).origin === self.location.origin);
  if (!client) return self.clients.openWindow(url);
  const focused = (await client.focus().catch(() => null)) ?? client;
  if (focused.url !== url) {
    // Chỉ đổi phần # là điều hướng trong trang: app tự đổi màn qua hashchange, không tải lại.
    await focused.navigate(url).catch(() => undefined);
  }
  return focused;
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || "/", self.location.origin).href;
  event.waitUntil(openApp(url));
});

function base64UrlToBytes(s) {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "="));
  return Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
}

const jsonHeaders = { Accept: "application/json", "Content-Type": "application/json" };

// Trình duyệt đổi/huỷ subscription (hết hạn, xoay khoá): đăng ký lại bằng khoá cũ, hoặc hỏi server khoá công khai,
// rồi gửi bản mới lên. Fetch cùng origin từ service worker mang cookie phiên — server gắn máy với người đang đăng nhập.
async function resubscribe(event) {
  let sub = event.newSubscription;
  if (!sub) {
    let key = event.oldSubscription?.options?.applicationServerKey;
    if (!key) {
      const res = await fetch("/v1/push", { credentials: "same-origin", headers: { Accept: "application/json" } });
      const payload = await res.json();
      if (!payload?.ok || typeof payload.data?.publicKey !== "string") return;
      key = base64UrlToBytes(payload.data.publicKey);
    }
    sub = await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  }
  const { endpoint, keys } = sub.toJSON();
  await fetch("/v1/push/subscriptions", {
    method: "POST",
    credentials: "same-origin",
    headers: jsonHeaders,
    body: JSON.stringify({ endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth }, user_agent: self.navigator.userAgent }),
  });
  const old = event.oldSubscription?.endpoint;
  if (old && old !== endpoint) {
    await fetch("/v1/push/subscriptions/remove", { method: "POST", credentials: "same-origin", headers: jsonHeaders, body: JSON.stringify({ endpoint: old }) });
  }
}

self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(resubscribe(event).catch(() => undefined));
});
