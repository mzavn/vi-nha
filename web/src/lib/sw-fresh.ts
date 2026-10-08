// Bao lâu service worker được trả bản lưu của một GET /v1/* mà không hỏi mạng (ADR-69), và đường nào service worker không đụng tới.
// File này không import gì: vite.config.ts dịch nó sang JS và chèn thẳng vào sw.js lúc build.

/** Cấu hình, danh mục, người thuê ít đổi: 5 phút. */
const SLOW = ["/v1/bootstrap", "/v1/settings", "/v1/categories", "/v1/rental"];

/** Số mili giây bản lưu còn "tươi" theo pathname; 0 = luôn hỏi mạng trước. Đường lạ: 30 giây. */
export function freshFor(pathname: string): number {
  if (pathname === "/v1/health" || pathname === "/v1/setup" || pathname === "/v1/session" || pathname.startsWith("/v1/session/")) return 0;
  if (SLOW.includes(pathname)) return 5 * 60_000;
  return 30_000;
}

/**
 * Đường của Worker mà service worker để thẳng ra mạng: webhook, MCP, trang uỷ quyền OAuth và CSS của nó, metadata OAuth.
 * Không có dòng này thì máy đã cài app mở /oauth/authorize (Claude mở trình duyệt) sẽ thấy app thay vì trang uỷ quyền.
 */
export function bypassWorker(pathname: string): boolean {
  return (
    pathname === "/mcp" ||
    pathname === "/oauth.css" ||
    ["/mcp/", "/webhooks/", "/oauth/", "/.well-known/"].some((p) => pathname.startsWith(p))
  );
}
