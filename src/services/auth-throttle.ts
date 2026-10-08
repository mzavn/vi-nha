// Chặn dò mật khẩu đăng nhập và khoá webhook (ADR-89): đếm lần sai theo IP trong cửa sổ cố định 15 phút ở D1
// (`auth_failures`). Đăng nhập có thêm trần chung mọi IP (dò từ nhiều IP). Không bao giờ lưu hay log mật khẩu / khoá đã thử.

export type ThrottleScope = "login" | "webhook";

export const THROTTLE_WINDOW_S = 15 * 60;
/** Số lần sai được phép trong một cửa sổ; tới ngưỡng thì chặn tới hết cửa sổ. `all`: trần chung mọi IP. */
export const THROTTLE_LIMITS: Record<ThrottleScope, { ip: number; all: number | null }> = {
  login: { ip: 10, all: 30 },
  webhook: { ip: 20, all: null },
};
/** Dòng đếm chung mọi IP. */
const ALL_IPS = "*";

/** IP người gọi: Cloudflare luôn gắn `CF-Connecting-IP` (người gọi không tự đặt được); chạy local thì không có. */
export const clientIp = (header: string | undefined) => header || "unknown";

const windowStart = (now: Date) => new Date(now.getTime() - THROTTLE_WINDOW_S * 1000).toISOString();

/** Số giây còn bị chặn (0 = không chặn). Chỉ đọc `auth_failures`, chạy trước mọi kiểm tra mật khẩu / khoá. */
export async function blockedFor(db: D1Database, scope: ThrottleScope, ip: string, now: Date): Promise<number> {
  const rows = await db
    .prepare("SELECT ip, first_at, failures FROM auth_failures WHERE scope = ? AND ip IN (?, ?) AND first_at > ?")
    .bind(scope, ip, ALL_IPS, windowStart(now))
    .all<{ ip: string; first_at: string; failures: number }>();
  let waitMs = 0;
  for (const r of rows.results) {
    const limit = r.ip === ALL_IPS ? THROTTLE_LIMITS[scope].all : THROTTLE_LIMITS[scope].ip;
    if (limit !== null && r.failures >= limit) waitMs = Math.max(waitMs, Date.parse(r.first_at) + THROTTLE_WINDOW_S * 1000 - now.getTime());
  }
  return Math.ceil(waitMs / 1000);
}

/** Ghi một lần sai (dọn dòng quá hạn trước) và log số lần — không kèm mật khẩu / khoá. Trả số lần sai của IP này. */
export async function recordFailure(db: D1Database, scope: ThrottleScope, ip: string, now: Date): Promise<number> {
  const bump = (key: string) =>
    db
      .prepare(
        `INSERT INTO auth_failures (scope, ip, first_at, failures) VALUES (?, ?, ?, 1)
         ON CONFLICT (scope, ip) DO UPDATE SET failures = failures + 1 RETURNING failures`,
      )
      .bind(scope, key, now.toISOString());
  const stmts = [db.prepare("DELETE FROM auth_failures WHERE first_at <= ?").bind(windowStart(now)), bump(ip)];
  if (THROTTLE_LIMITS[scope].all !== null) stmts.push(bump(ALL_IPS));
  const results = await db.batch<{ failures: number }>(stmts);
  const failures = results[1]?.results[0]?.failures ?? 1;
  console.warn(`[auth] ${scope} sai: ip ${ip}, lần ${failures} trong ${THROTTLE_WINDOW_S / 60} phút`);
  return failures;
}

/** Đăng nhập đúng: xoá đếm của IP này (gõ nhầm vài lần rồi đúng không bị chặn lần sau). Trần chung giữ nguyên. */
export async function clearFailures(db: D1Database, scope: ThrottleScope, ip: string): Promise<void> {
  await db.prepare("DELETE FROM auth_failures WHERE scope = ? AND ip = ?").bind(scope, ip).run();
}
