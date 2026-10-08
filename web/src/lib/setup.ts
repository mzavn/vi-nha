// Logic thuần của màn Thiết lập nhà lần đầu (UC-510, UC-701 AC-8): form bốn bước, kiểm từng bước như server,
// dựng thân POST /v1/setup, đưa lỗi server (`field` dạng dấu chấm) về đúng ô và đúng bước.

import { ApiError, errorText, request } from "./api";
import { clashWith, MAX_MEMBERS, nameError, passwordError } from "./members";
import { done, type Errors, type Result } from "./settings";
import type { SettingsAccount } from "./types";

export const SETUP_STEPS = ["Mật khẩu chung", "Thành viên", "Tài khoản", "Ví theo mẫu"] as const;
export type SetupStep = 0 | 1 | 2 | 3;

export type MustChoice = "food" | "housing" | "transport" | "utilities";
/** Ví Must chọn được trong mẫu "Profit First cơ bản", theo thứ tự gửi lên server. */
export const MUST_OPTIONS: { value: MustChoice; label: string }[] = [
  { value: "food", label: "Ăn uống" },
  { value: "housing", label: "Nhà ở" },
  { value: "transport", label: "Đi lại" },
  { value: "utilities", label: "Điện nước" },
];

export const MAX_ACCOUNT_NAME = 60;

export interface SetupMember {
  name: string;
  /** Mật khẩu riêng; trống = người này vào bằng mật khẩu chung. */
  password: string;
}
export interface SetupAccount {
  name: string;
  kind: SettingsAccount["kind"];
  /** Mã ngân hàng (ngân hàng, thẻ) hay tên nhà cung cấp (ví điện tử); tiền mặt bỏ qua. */
  bank: string;
  /** Chỉ số người giữ trong `members`; null = tài khoản chung. */
  owner: number | null;
}
export interface SetupForm {
  password: string;
  members: SetupMember[];
  accounts: SetupAccount[];
  /** Có thu nhập phải tự nộp thuế không; null = chưa trả lời. */
  taxable: boolean | null;
  must: MustChoice[];
}

export interface SetupBody {
  password: string;
  members: { name: string; password?: string }[];
  accounts: { name: string; kind: SettingsAccount["kind"]; bank?: string; owner: number | null }[];
  template: { taxable: boolean; must: MustChoice[] };
}

export const emptySetup = (): SetupForm => ({
  password: "",
  members: [{ name: "", password: "" }],
  accounts: [{ name: "", kind: "bank", bank: "", owner: null }],
  taxable: null,
  must: MUST_OPTIONS.map((o) => o.value),
});

/**
 * Mở app: có cần hiện màn Thiết lập thay màn đăng nhập không (UC-701 AC-8). Không hỏi được server — mất mạng, lỗi,
 * hay chỉ có bản service worker lưu từ trước — thì false: màn đăng nhập như hiện nay.
 */
export async function setupNeeded(): Promise<boolean> {
  try {
    const r = await request<{ needed?: unknown }>("/v1/setup", "GET", undefined, true);
    return r.cachedAt === null && r.data?.needed === true;
  } catch {
    return false;
  }
}

function memberErrors(members: SetupMember[]): Errors {
  const errors: Errors = {};
  if (members.length === 0) errors.members = "Cần ít nhất một người.";
  else if (members.length > MAX_MEMBERS) errors.members = `Tối đa ${MAX_MEMBERS} người.`;
  members.forEach((m, i) => {
    const bad = nameError(m.name);
    const clash = bad ? null : clashWith(m.name, members.slice(0, i));
    if (bad) errors[`members.${i}.name`] = bad;
    else if (clash) errors[`members.${i}.name`] = `Trùng với ${clash}.`;
    const pw = passwordError(m.password, true);
    if (pw) errors[`members.${i}.password`] = pw;
  });
  return errors;
}

function accountErrors(accounts: SetupAccount[], memberCount: number): Errors {
  const errors: Errors = {};
  if (accounts.length === 0) errors.accounts = "Cần ít nhất một tài khoản.";
  accounts.forEach((a, i) => {
    const bad = nameError(a.name, MAX_ACCOUNT_NAME);
    const clash = bad ? null : clashWith(a.name, accounts.slice(0, i));
    if (bad) errors[`accounts.${i}.name`] = bad;
    else if (clash) errors[`accounts.${i}.name`] = `Trùng với ${clash}.`;
    if (a.owner !== null && !(Number.isInteger(a.owner) && a.owner >= 0 && a.owner < memberCount)) errors[`accounts.${i}.owner`] = "Chọn lại người giữ.";
  });
  return errors;
}

/** Lỗi của một bước, khoá theo `field` của server ("members.0.name"…); rỗng = được bấm Tiếp. */
export function stepErrors(f: SetupForm, step: SetupStep): Errors {
  if (step === 0) return f.password ? {} : { password: "Nhập mật khẩu chung đã đặt lúc deploy." };
  if (step === 1) return memberErrors(f.members);
  if (step === 2) return accountErrors(f.accounts, f.members.length);
  return f.taxable === null ? { "template.taxable": "Chọn Có hoặc Không." } : {};
}

export function setupPayload(f: SetupForm): Result<SetupBody> {
  const errors: Errors = { ...stepErrors(f, 0), ...stepErrors(f, 1), ...stepErrors(f, 2), ...stepErrors(f, 3) };
  return done(errors, () => ({
    password: f.password,
    members: f.members.map((m) => ({ name: m.name.trim(), ...(m.password ? { password: m.password } : {}) })),
    accounts: f.accounts.map((a) => ({ name: a.name.trim(), kind: a.kind, ...(a.kind !== "cash" && a.bank.trim() ? { bank: a.bank.trim() } : {}), owner: a.owner })),
    template: { taxable: f.taxable!, must: MUST_OPTIONS.map((o) => o.value).filter((v) => f.must.includes(v)) },
  }));
}

/** Bớt người thứ `index`: tài khoản của người đó thành chung, chỉ số của người sau lùi một. */
export function removeMember(f: SetupForm, index: number): SetupForm {
  return {
    ...f,
    members: f.members.filter((_, i) => i !== index),
    accounts: f.accounts.map((a) => ({ ...a, owner: a.owner === null || a.owner === index ? null : a.owner > index ? a.owner - 1 : a.owner })),
  };
}

/** Bước chứa ô `field` của server; field lạ → null. */
export function stepOfField(field: string): SetupStep | null {
  const head = field.split(/[.[]/)[0];
  if (head === "password") return 0;
  if (head === "members") return 1;
  if (head === "accounts") return 2;
  if (head === "template") return 3;
  return null;
}

/** Lỗi của POST /v1/setup: bước cần mở lại (null = giữ bước đang đứng), lỗi từng ô, hay câu chung dưới nút. */
export function setupServerError(err: unknown): { step: SetupStep | null; errors: Errors; message: string | null } {
  if (err instanceof ApiError) {
    if (err.offline) return { step: null, errors: {}, message: "Không có mạng. Thiết lập cần mạng." };
    if (err.code === "wrong_password") return { step: 0, errors: { password: err.message }, message: null };
    // "members[1].name" → "members.1.name": khoá lỗi luôn theo dạng dấu chấm, như id ô ở màn Thiết lập.
    const field = err.field?.replace(/\[(\d+)\]/g, ".$1");
    const step = field ? stepOfField(field) : null;
    if (field && step !== null) return { step, errors: { [field]: err.message }, message: null };
  }
  return { step: null, errors: {}, message: errorText(err) };
}
