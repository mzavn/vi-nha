// Logic thuần của Cài đặt › Thành viên (UC-507, UC-709) và phần thành viên của màn Thiết lập (UC-510):
// kiểm tên, mật khẩu riêng, dựng thân yêu cầu. Luật y như server; server vẫn kiểm lại.

import { ApiError, errorText } from "./api";
import { done, type Errors, type Result } from "./settings";
import type { SettingsMember } from "./types";

/** Tối đa 6 người đang dùng (ADR nháp "Tối đa 6 người ngang quyền"). */
export const MAX_MEMBERS = 6;
export const MAX_NAME = 40;
export const MIN_PASSWORD = 8;

/** Mã sinh từ tên, như server (`slug` ở src/services/settings.ts): bỏ dấu, chữ thường, gạch nối. */
export const codeOf = (name: string): string =>
  name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/gi, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);

/** Lỗi của một tên (đã cắt khoảng trắng hai đầu); null = được. */
export function nameError(name: string, max = MAX_NAME): string | null {
  const t = name.trim();
  if (!t) return "Nhập tên.";
  if (t.length > max) return `Tên tối đa ${max} ký tự.`;
  if (!codeOf(t)) return "Tên cần có chữ hoặc số.";
  return null;
}

/** Tên `name` trùng tên hay trùng mã với ai trong `others` → tên người đó; không trùng → null. */
export function clashWith(name: string, others: { name: string; id?: string }[]): string | null {
  const code = codeOf(name);
  const lower = name.trim().toLowerCase();
  return others.find((o) => o.name.trim().toLowerCase() === lower || codeOf(o.name) === code || o.id === code)?.name ?? null;
}

/** Mật khẩu riêng: để trống được (`optional`), có thì ít nhất 8 ký tự. */
export function passwordError(password: string, optional: boolean): string | null {
  if (!password) return optional ? null : `Nhập mật khẩu mới, ít nhất ${MIN_PASSWORD} ký tự.`;
  return password.length < MIN_PASSWORD ? `Mật khẩu riêng ít nhất ${MIN_PASSWORD} ký tự.` : null;
}

export const canAddMember = (members: Pick<SettingsMember, "active">[]): boolean => members.filter((m) => m.active).length < MAX_MEMBERS;

/** Dòng nhỏ dưới tên người (UC-709). */
export const passwordLine = (m: Pick<SettingsMember, "has_password">): string => (m.has_password ? "dùng mật khẩu riêng" : "dùng mật khẩu chung");

/** Thêm người: trùng tên / mã với bất kỳ ai, kể cả người đã tắt, là lỗi (UC-507 AC-11). */
export function newMemberPayload(f: { name: string; password: string }, members: Pick<SettingsMember, "id" | "name">[]): Result<{ name: string; password?: string }> {
  const errors: Errors = {};
  const name = f.name.trim();
  const bad = nameError(name);
  const clash = bad ? null : clashWith(name, members);
  if (bad) errors.name = bad;
  else if (clash) errors.name = `Trùng với ${clash} (cả người đã tắt).`;
  const pw = passwordError(f.password, true);
  if (pw) errors.password = pw;
  return done(errors, () => ({ name, ...(f.password ? { password: f.password } : {}) }));
}

/** Xác nhận bằng mật khẩu đang dùng để vào tên mình, hay bằng mật khẩu chung của nhà. */
export type ProofMode = "current" | "household";

/**
 * Đổi của người khác luôn hỏi mật khẩu chung. Đổi của mình: có mật khẩu riêng thì hỏi mật khẩu riêng đang dùng,
 * trừ khi chọn dùng mật khẩu chung (quên mật khẩu riêng); chưa có thì mật khẩu đang dùng chính là mật khẩu chung.
 */
export const proofMode = (o: { self: boolean; hasPassword: boolean; useHousehold: boolean }): ProofMode =>
  o.self && o.hasPassword && !o.useHousehold ? "current" : "household";

export type PasswordBody = { current?: string; household_password?: string; password: string | null };

/** PUT /v1/settings/members/:id/password — `remove`: gỡ, người đó quay lại dùng mật khẩu chung. */
export function passwordPayload(f: { proof: string; password: string; remove: boolean }, mode: ProofMode): Result<PasswordBody> {
  const errors: Errors = {};
  if (!f.proof) errors.proof = mode === "current" ? "Nhập mật khẩu riêng đang dùng." : "Nhập mật khẩu chung của nhà.";
  const pw = f.remove ? null : passwordError(f.password, false);
  if (pw) errors.password = pw;
  return done(errors, () => ({ ...(mode === "current" ? { current: f.proof } : { household_password: f.proof }), password: f.remove ? null : f.password }));
}

/**
 * Lỗi server của các sheet thành viên: ô nào (null = câu chung dưới nút) và câu gì. Chỉ trả ô các sheet có
 * ("name", "password", "proof" = ô mật khẩu xác nhận); ô lạ thành câu chung để không bị mất lỗi.
 */
export function memberSubmitError(err: unknown): { field: string | null; message: string } {
  if (!(err instanceof ApiError)) return { field: null, message: errorText(err) };
  if (err.code === "duplicate") return { field: "name", message: err.message };
  if (err.code === "wrong_password" || err.field === "current" || err.field === "household_password") return { field: "proof", message: err.message };
  if (err.field === "name" || err.field === "password") return { field: err.field, message: err.message };
  return { field: null, message: err.offline ? "Không có mạng. Việc này cần mạng." : err.message };
}
