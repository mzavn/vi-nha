import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "./env";

/**
 * Header bảo mật cho mọi phản hồi (ADR-89). Một nguồn duy nhất: Worker gắn cho /v1, /webhooks, /mcp, /oauth; app shell do
 * Workers Static Assets phục vụ thẳng, đọc bản chép ở `web/public/_headers` (test giữ hai nơi khớp nhau).
 * CSP: chỉ script của chính app; Google Fonts cho CSS/font — service worker tự fetch font để lưu offline nên
 * connect-src cũng cần hai origin đó. Không 'unsafe-inline': style={{}} của Preact đi qua CSSOM, không bị chặn.
 */
export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  "Content-Security-Policy": [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data:",
    "connect-src 'self' https://fonts.googleapis.com https://fonts.gstatic.com",
    "worker-src 'self'",
    "manifest-src 'self'",
    "frame-src https://mzavn.gitbook.io",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join("; "),
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "same-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  "X-Frame-Options": "DENY",
};

/**
 * Gắn SECURITY_HEADERS vào phản hồi của Worker. Phản hồi phải có header sửa được (không phải nguyên bản từ fetch()).
 * Trang uỷ quyền OAuth (UC-601 AC-9) đặt `formActionOrigin` = origin của `redirect_uri` đã được thư viện xác thực: bấm
 * Đồng ý / Từ chối là form POST rồi chuyển hướng sang ứng dụng, trình duyệt áp `form-action` cho cả bước chuyển đó.
 */
export const securityHeaders: MiddlewareHandler<AppEnv> = async (c, next) => {
  await next();
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) c.res.headers.set(name, value);
  const extra = c.get("formActionOrigin");
  if (extra) {
    c.res.headers.set("Content-Security-Policy", SECURITY_HEADERS["Content-Security-Policy"]!.replace("form-action 'self'", `form-action 'self' ${extra}`));
  }
};
