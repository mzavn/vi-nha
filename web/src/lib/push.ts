// Thông báo đẩy trên máy này: các hàm thuần (không chạm trình duyệt) để màn Cài đặt và store dùng chung, test được.

import { shortDate, timeHM } from "./period";
import type { PushTestSeries } from "./types";

/** Trạng thái thẻ "Thông báo trên máy này". */
export type PushState = "unsupported" | "needs-install" | "off" | "blocked" | "on";

export interface PushCaps {
  /** Có `serviceWorker`, `PushManager` và `Notification`. */
  supported: boolean;
  /** iPhone/iPad: web push chỉ chạy khi mở từ icon ngoài màn hình chính. */
  ios: boolean;
  standalone: boolean;
  permission: NotificationPermission | null;
  /** Máy này đang có subscription. */
  subscribed: boolean;
}

export function pushState(c: PushCaps): PushState {
  // iOS trong Safari thường không có PushManager — vẫn nên chỉ cách cài thay vì nói "không hỗ trợ".
  if (c.ios && !c.standalone) return "needs-install";
  if (!c.supported) return "unsupported";
  if (c.permission === "denied") return "blocked";
  return c.subscribed && c.permission === "granted" ? "on" : "off";
}

/** iPhone, iPod, iPad — kể cả iPadOS tự nhận là Mac (Macintosh + màn cảm ứng). */
export function isIos(userAgent: string, maxTouchPoints = 0): boolean {
  return /iPhone|iPad|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1);
}

/** Khoá công khai VAPID base64url → byte cho `applicationServerKey`. */
export function base64UrlToBytes(s: string): Uint8Array<ArrayBuffer> {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "=");
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Nhãn ngắn cho máy, vd "iPhone · Safari", "Android · Chrome". */
export function deviceLabel(userAgent: string, maxTouchPoints = 0): string {
  const ua = userAgent;
  const device = /iPhone|iPod/.test(ua)
    ? "iPhone"
    : /iPad/.test(ua) || (/Macintosh/.test(ua) && maxTouchPoints > 1)
      ? "iPad"
      : /Android/.test(ua)
        ? "Android"
        : /Macintosh|Mac OS X/.test(ua)
          ? "Mac"
          : /Windows/.test(ua)
            ? "Windows"
            : /CrOS/.test(ua)
              ? "ChromeOS"
              : /Linux/.test(ua)
                ? "Linux"
                : null;
  const browser = /Edg(A|iOS)?\//.test(ua)
    ? "Edge"
    : /SamsungBrowser\//.test(ua)
      ? "Samsung Internet"
      : /OPR\/|Opera/.test(ua)
        ? "Opera"
        : /Firefox\/|FxiOS\//.test(ua)
          ? "Firefox"
          : /Chrome\/|CriOS\//.test(ua)
            ? "Chrome"
            : /Safari\//.test(ua)
              ? "Safari"
              : null;
  return [device, browser].filter(Boolean).join(" · ") || "Máy không rõ";
}

/** Giờ SQLite `2026-10-01 07:00:00` (UTC, không ghi múi) → ISO; ISO đầy đủ thì giữ nguyên. */
export function sqliteUtcToIso(s: string): string {
  return /^\d{4}-\d\d-\d\d \d\d:\d\d(:\d\d)?$/.test(s) ? `${s.replace(" ", "T")}Z` : s;
}

/** Dòng phụ của một máy trong danh sách: lần cuối gửi tới được máy đó. */
export function lastOkText(lastOkAt: string | null): string {
  if (!lastOkAt) return "chưa nhận tin nào";
  const iso = sqliteUtcToIso(lastOkAt);
  return `nhận tin gần nhất ${timeHM(iso)} ${shortDate(iso)}`;
}

/** Server chờ chừng này trước tin 1 của lượt gửi thử (`src/services/push.ts` › `runTestSeries`). */
const SERIES_FIRST_DELAY_S = 10;

/** Dòng "Thử khi tắt app" theo lượt gần nhất; `active` = đang gửi (hiện nút Huỷ thay nút bắt đầu, đọc lại định kỳ). */
export function seriesView(s: PushTestSeries | null): { active: boolean; title: string; sub: string } {
  if (!s) return { active: false, title: "Kiểm tra khi app đã tắt", sub: "Gửi 2 tin thử để xem thông báo có về khi app đã đóng." };
  const second = s.count > 1 ? `, tin 2 sau khoảng ${SERIES_FIRST_DELAY_S + s.interval_s} giây` : "";
  switch (s.status) {
    case "pending": // dòng cũ (trước khi server gửi ngay trong request); cron huỷ sau 10 phút
    case "running":
      return { active: true, title: `Đang gửi thử: ${s.sent}/${s.count} tin`, sub: `Vuốt tắt app ngay. Tin 1 về sau khoảng ${SERIES_FIRST_DELAY_S} giây${second}.` };
    case "done":
      return s.sent > 0
        ? { active: false, title: `Đã gửi thử ${s.sent}/${s.count} tin`, sub: "Thấy đủ tin khi app đã tắt là thông báo chạy tốt." }
        : { active: false, title: "Chưa gửi được tin thử nào", sub: "Server không còn giữ máy này. Tắt rồi bật lại thông báo." };
    case "cancelled":
      return { active: false, title: "Đã huỷ gửi thử", sub: `Đã gửi ${s.sent}/${s.count} tin trước khi huỷ.` };
  }
}
