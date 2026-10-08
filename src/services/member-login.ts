// Đăng nhập bằng mật khẩu của app (UC-501) dùng chung cho màn đăng nhập PWA (`POST /v1/session`) và trang uỷ quyền
// Claude (`/oauth/authorize`, UC-601 AC-9): cùng bộ chặn dò scope `login` (ADR-89), cùng luật mật khẩu riêng / chung.
// Mỗi nơi tự dựng câu trả lời (JSON hay trang HTML) từ kết quả ở đây.

import { blockedFor, clearFailures, recordFailure } from "./auth-throttle";
import { memberPasswordOk } from "./passwords";
import { isSetUp } from "./setup";

export interface LoginMember {
  id: string;
  name: string;
  /** Cách vào: `h` = mật khẩu chung của nhà, `p` = mật khẩu riêng. */
  mode: "h" | "p";
  sessionGen: number;
}

export type LoginResult =
  | { ok: true; member: LoginMember }
  | { ok: false; reason: "too_many_attempts"; retryAfter: number }
  | { ok: false; reason: "setup_required" | "wrong_password" | "unknown_member" };

/** "Sai mật khẩu quá nhiều lần, thử lại sau N phút." */
export const tooManyAttemptsMessage = (retryAfter: number) => `Sai mật khẩu quá nhiều lần, thử lại sau ${Math.max(1, Math.ceil(retryAfter / 60))} phút.`;

/** Sai mật khẩu: ghi một lần sai vào bộ chặn dò, rồi chậm một nhịp để việc dò tốn thời gian hơn. */
export async function recordWrongPassword(db: D1Database, ip: string, now: Date): Promise<void> {
  await recordFailure(db, "login", ip, now);
  await new Promise((r) => setTimeout(r, 400));
}

/**
 * (1) đang bị chặn dò → too_many_attempts, trước khi so mật khẩu; (2) chưa thiết lập nhà → setup_required;
 * (3) người có mật khẩu riêng → chỉ so băm, còn lại so mật khẩu chung (sai → wrong_password trước; đúng mà người lạ →
 * unknown_member); (4) đúng thì xoá đếm sai, sai thì ghi một lần sai. Kết quả không cho biết ai có mật khẩu riêng.
 */
export async function checkLogin(db: D1Database, appPassword: string | undefined, ip: string, memberId: string, password: string, now: Date): Promise<LoginResult> {
  const wait = await blockedFor(db, "login", ip, now);
  if (wait > 0) return { ok: false, reason: "too_many_attempts", retryAfter: wait };
  if (!(await isSetUp(db))) return { ok: false, reason: "setup_required" };
  const member = await db
    .prepare("SELECT id, name, password_hash, session_gen FROM members WHERE id = ? AND active = 1")
    .bind(memberId)
    .first<{ id: string; name: string; password_hash: string | null; session_gen: number }>();
  if (!(await memberPasswordOk(appPassword, password, member?.password_hash ?? null))) {
    await recordWrongPassword(db, ip, now);
    return { ok: false, reason: "wrong_password" };
  }
  await clearFailures(db, "login", ip);
  if (!member) return { ok: false, reason: "unknown_member" };
  return { ok: true, member: { id: member.id, name: member.name, mode: member.password_hash ? "p" : "h", sessionGen: member.session_gen } };
}
