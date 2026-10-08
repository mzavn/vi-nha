// Báo có bản mới (pwa UC-710): app đã cài mở lại từ nền không điều hướng trang, nên trình duyệt không tự hỏi sw.js mới
// — app chạy bản cũ tới khi tắt hẳn. Ở đây: hỏi bản mới lúc mở, mỗi lần quay lại app và mỗi 30 phút khi đang mở.
// sw.js mới tự skipWaiting + clients.claim (web/sw.js) nên nó giành quyền ngay → `controllerchange` → hiện thanh
// "Đã có bản mới" kèm nút Tải bản mới (tải lại trang lấy app shell mới). Không tự tải lại để khỏi cắt ngang lúc đang nhập.
// Cách làm theo mza-giapha (thanh "Đã có bản mới … Tải lại"), dùng chính service worker thay cho /version.txt.

import { setState } from "./store";

const CHECK_EVERY_MS = 30 * 60_000;

export function registerServiceWorker(): void {
  if (!("serviceWorker" in navigator)) return;
  const sw = navigator.serviceWorker;
  // Lần cài đầu cũng sinh controllerchange — chỉ báo khi trang đang do một service worker cũ điều khiển.
  let hadController = Boolean(sw.controller);
  sw.addEventListener("controllerchange", () => {
    if (hadController) setState({ updateReady: true });
    hadController = true;
  });

  addEventListener("load", () => {
    sw.register("/sw.js")
      .then((reg) => {
        const check = () => {
          if (document.visibilityState === "visible" && navigator.onLine) void reg.update().catch(() => undefined);
        };
        document.addEventListener("visibilitychange", check);
        setInterval(check, CHECK_EVERY_MS);
      })
      .catch(() => {
        // không đăng ký được (ví dụ trình duyệt chặn): app vẫn chạy, chỉ không mở được khi mất mạng
      });
  });
}

/** Nút "Tải bản mới": service worker mới đã giữ app shell mới, tải lại trang là chạy bản mới. */
export const applyUpdate = (): void => location.reload();
