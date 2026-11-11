// Logic thuần của màn Thiết lập nhà lần đầu (UC-510, UC-701 AC-8): form bốn bước, kiểm từng bước như server,
// dựng thân POST /v1/setup, dòng "Sẽ tạo: …" của bước Ba ngăn, đưa lỗi server (`field` dạng dấu chấm) về đúng ô và đúng bước.

import { ApiError, errorText, request } from "./api";
import { clashWith, MAX_MEMBERS, nameError, passwordError } from "./members";
import { parseAmount } from "./money";
import { POCKET_ORDER, pocketLabel } from "./pockets";
import { done, type Errors, parseInteger, type Result } from "./settings";
import type { Pocket, SettingsAccount } from "./types";

export const SETUP_STEPS = ["Mật khẩu chung", "Thành viên", "Tài khoản", "Ba ngăn"] as const;
export type SetupStep = 0 | 1 | 2 | 3;

export type GroupChoice = "food" | "housing" | "transport" | "utilities";
/** Nhóm danh mục Thiết yếu mẫu, theo thứ tự gửi lên server; Y tế và Mua sắm server luôn tạo. */
export const GROUP_OPTIONS: { value: GroupChoice; label: string }[] = [
  { value: "food", label: "Ăn uống" },
  { value: "housing", label: "Nhà ở" },
  { value: "transport", label: "Đi lại" },
  { value: "utilities", label: "Điện nước" },
];
const ALWAYS_GROUPS = ["Y tế", "Mua sắm"];

export const MAX_ACCOUNT_NAME = 60;
export const MAX_GOALS = 10;
export const MAX_GOAL_NAME = 60;
/** Mục tiêu server tự tạo khi nhà tự nộp thuế (UC-510 bước 4): tên mục tiêu khác không được trùng mã. */
const TAX_GOAL = { name: "Thuế", id: "thue" };

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
  /** Ngăn của tài khoản; mặc định Vận hành, null = ngoài ngăn. */
  pocket: Pocket | null;
}
/** Mục tiêu Dự phòng tuỳ chọn: chữ người gõ. */
export interface SetupGoal {
  name: string;
  /** Số mỗi tháng. */
  monthly: string;
  /** Mấy tháng một lần (1–12). */
  repeat: string;
  /** Tài khoản của mục tiêu: chỉ số trong `accounts` (phải ở ngăn Dự phòng, UC-510 AC-14); null = Chưa có. */
  account: number | null;
}
export interface SetupForm {
  password: string;
  members: SetupMember[];
  accounts: SetupAccount[];
  /** Ngày lương 1–31 (chữ trong ô). */
  paydayDay: string;
  /** % Tích luỹ mỗi kỳ lương 1–100 (chữ trong ô). */
  savingsPct: string;
  /** Nhà có tự nộp thuế không; null = chưa trả lời. */
  taxable: boolean | null;
  groups: GroupChoice[];
  goals: SetupGoal[];
}

export interface SetupBody {
  password: string;
  members: { name: string; password?: string }[];
  accounts: { name: string; kind: SettingsAccount["kind"]; bank?: string; owner: number | null; pocket: Pocket | null }[];
  payday_day: number;
  savings_pct: number;
  taxable: boolean;
  groups: GroupChoice[];
  goals: { name: string; monthly_amount: number; repeat_months: number; account?: number }[];
}

export const newAccount = (): SetupAccount => ({ name: "", kind: "bank", bank: "", owner: null, pocket: "operating" });
export const newGoal = (): SetupGoal => ({ name: "", monthly: "", repeat: "1", account: null });

export const emptySetup = (): SetupForm => ({
  password: "",
  members: [{ name: "", password: "" }],
  accounts: [newAccount()],
  paydayDay: "10",
  savingsPct: "10",
  taxable: null,
  groups: GROUP_OPTIONS.map((o) => o.value),
  goals: [],
});

/** Ô chọn ngăn: Vận hành đứng đầu (mặc định), rồi Tích luỹ, Dự phòng, Ngoài ngăn. */
export const SETUP_POCKET_OPTIONS: { value: Pocket | null; label: string }[] = [
  "operating" as const,
  ...POCKET_ORDER.filter((p) => p !== "operating"),
].map((p) => ({ value: p, label: pocketLabel(p) }));

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

/** Tài khoản chọn được cho mục tiêu thứ `index`: tài khoản ngăn Dự phòng đã nhập, chưa thuộc mục tiêu khác (UC-510 AC-14). */
export function goalAccountChoices(f: SetupForm, index: number): { index: number; name: string }[] {
  const taken = new Set(f.goals.flatMap((g, i) => (i !== index && g.account !== null ? [g.account] : [])));
  return f.accounts.flatMap((a, i) => (a.pocket === "reserve" && !taken.has(i) ? [{ index: i, name: a.name.trim() || `Tài khoản ${i + 1}` }] : []));
}

const MONEY_MAX = 1e12;

function pocketErrors(f: SetupForm): Errors {
  const errors: Errors = {};
  if (parseInteger(f.paydayDay, 1, 31) === null) errors.payday_day = "Ngày lương từ 1 đến 31.";
  if (parseInteger(f.savingsPct, 1, 100) === null) errors.savings_pct = "% Tích luỹ từ 1 đến 100.";
  if (f.taxable === null) errors.taxable = "Chọn Có hoặc Không.";
  if (f.goals.length > MAX_GOALS) errors.goals = `Tối đa ${MAX_GOALS} mục tiêu.`;
  const reserved = f.taxable ? [TAX_GOAL] : [];
  f.goals.forEach((g, i) => {
    const bad = nameError(g.name, MAX_GOAL_NAME);
    const clash = bad ? null : clashWith(g.name, [...reserved, ...f.goals.slice(0, i)]);
    if (bad) errors[`goals.${i}.name`] = bad;
    else if (clash) errors[`goals.${i}.name`] = `Trùng tên với “${clash}”.`;
    const monthly = parseAmount(g.monthly);
    if (monthly <= 0 || monthly > MONEY_MAX) errors[`goals.${i}.monthly_amount`] = "Nhập số mỗi tháng.";
    if (parseInteger(g.repeat, 1, 12) === null) errors[`goals.${i}.repeat_months`] = "Từ 1 đến 12 tháng.";
    if (g.account !== null) {
      if (f.accounts[g.account]?.pocket !== "reserve") errors[`goals.${i}.account`] = "Tài khoản của mục tiêu phải ở ngăn Dự phòng.";
      else if (f.goals.slice(0, i).some((x) => x.account === g.account)) errors[`goals.${i}.account`] = "Mỗi tài khoản chỉ cho một mục tiêu.";
    }
  });
  return errors;
}

/** Lỗi của một bước, khoá theo `field` của server ("members.0.name"…); rỗng = được bấm Tiếp. */
export function stepErrors(f: SetupForm, step: SetupStep): Errors {
  if (step === 0) return f.password ? {} : { password: "Nhập mật khẩu chung đã đặt lúc deploy." };
  if (step === 1) return memberErrors(f.members);
  if (step === 2) return accountErrors(f.accounts, f.members.length);
  return pocketErrors(f);
}

export function setupPayload(f: SetupForm): Result<SetupBody> {
  const errors: Errors = { ...stepErrors(f, 0), ...stepErrors(f, 1), ...stepErrors(f, 2), ...stepErrors(f, 3) };
  return done(errors, () => ({
    password: f.password,
    members: f.members.map((m) => ({ name: m.name.trim(), ...(m.password ? { password: m.password } : {}) })),
    accounts: f.accounts.map((a) => ({
      name: a.name.trim(),
      kind: a.kind,
      ...(a.kind !== "cash" && a.bank.trim() ? { bank: a.bank.trim() } : {}),
      owner: a.owner,
      pocket: a.pocket,
    })),
    payday_day: parseInteger(f.paydayDay, 1, 31)!,
    savings_pct: parseInteger(f.savingsPct, 1, 100)!,
    taxable: f.taxable!,
    groups: GROUP_OPTIONS.map((o) => o.value).filter((v) => f.groups.includes(v)),
    goals: f.goals.map((g) => ({
      name: g.name.trim(),
      monthly_amount: parseAmount(g.monthly),
      repeat_months: parseInteger(g.repeat, 1, 12)!,
      ...(g.account === null ? {} : { account: g.account }),
    })),
  }));
}

/** Dòng "Sẽ tạo: …" của bước Ba ngăn: ngăn và tài khoản, nguồn "Lương", nhóm danh mục, mục tiêu Dự phòng. */
export function setupSummary(f: SetupForm): string {
  const named = f.accounts.map((a, i) => ({ pocket: a.pocket, name: a.name.trim() || `Tài khoản ${i + 1}` }));
  const pockets = SETUP_POCKET_OPTIONS.flatMap(({ value, label }) => {
    const names = named.filter((a) => a.pocket === value).map((a) => a.name);
    return names.length ? [`${label}: ${names.join(", ")}`] : [];
  });
  const groups = [...GROUP_OPTIONS.filter((o) => f.groups.includes(o.value)).map((o) => o.label), ...ALWAYS_GROUPS];
  const goals = [...f.goals.map((g) => g.name.trim()).filter(Boolean), ...(f.taxable ? [`${TAX_GOAL.name} 10%`] : [])];
  const parts = [
    ...pockets,
    "nguồn “Lương” mở kỳ lương",
    `nhóm ${groups.join(", ")}`,
    ...(goals.length ? [`mục tiêu Dự phòng ${goals.join(", ")}`] : []),
  ];
  return `Sẽ tạo: ${parts.join(" · ")}.`;
}

/** Bớt người thứ `index`: tài khoản của người đó thành chung, chỉ số của người sau lùi một. */
export function removeMember(f: SetupForm, index: number): SetupForm {
  return {
    ...f,
    members: f.members.filter((_, i) => i !== index),
    accounts: f.accounts.map((a) => ({ ...a, owner: a.owner === null || a.owner === index ? null : a.owner > index ? a.owner - 1 : a.owner })),
  };
}

/** Bớt tài khoản thứ `index`: mục tiêu gắn tài khoản đó về Chưa có, chỉ số của tài khoản sau lùi một. */
export function removeAccount(f: SetupForm, index: number): SetupForm {
  return {
    ...f,
    accounts: f.accounts.filter((_, i) => i !== index),
    goals: f.goals.map((g) => ({ ...g, account: g.account === null || g.account === index ? null : g.account > index ? g.account - 1 : g.account })),
  };
}

/** Bước chứa ô `field` của server; field lạ → null. Ô ngăn của tài khoản nằm ở bước Ba ngăn. */
export function stepOfField(field: string): SetupStep | null {
  const [head, , sub] = field.split(/[.[\]]+/);
  if (head === "password") return 0;
  if (head === "members") return 1;
  if (head === "accounts") return sub === "pocket" ? 3 : 2;
  if (head === "payday_day" || head === "savings_pct" || head === "taxable" || head === "groups" || head === "goals") return 3;
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
