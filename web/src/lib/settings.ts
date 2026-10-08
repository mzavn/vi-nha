// Logic thuần của màn Cài đặt: kiểm tra form, đổi form ↔ thân yêu cầu, hiện bí mật chỉ-ghi.
// Không đụng DOM hay mạng để test được bằng vitest.

import { bankByCode } from "../../../src/domain/banks";
import { clockMinutes } from "../../../src/domain/notify-schedule";
import { DEFAULT_SEPAY_CONNECTION_ID } from "../../../src/domain/system-ids";
import { formatVnd } from "./money";
import { sqliteUtcToIso } from "./push";
import { shortDate, timeHM } from "./period";
import type { Allocation, AllocationMode, AuditEntry, IncomeStream, NotifySchedule, Rule, Secret, SepayConnection, SettingsAccount, SettingsConfig, SettingsMember, SettingsWallet } from "./types";

export type Errors = Record<string, string>;
export type Result<T> = { ok: true; value: T } | { ok: false; errors: Errors };

export const done = <T>(errors: Errors, value: () => T): Result<T> => (Object.keys(errors).length ? { ok: false, errors } : { ok: true, value: value() });
const orNull = (s: string) => (s.trim() ? s.trim() : null);

/** Số nguyên không dấu trong khoảng; chuỗi rỗng hay có chữ → null. */
export function parseInteger(text: string, min: number, max: number): number | null {
  const t = text.trim();
  if (!/^\d+$/.test(t)) return null;
  const n = Number(t);
  return n >= min && n <= max ? n : null;
}

// ── Bí mật chỉ ghi ────────────────────────────────────────────────

/** "Đã đặt ••••12" / "Chưa đặt". Chỉ lấy tối đa 2 ký tự cuối kể cả khi server lỡ trả nhiều hơn (ADR-90). */
export function secretLabel(s: Secret): string {
  if (!s.set) return "Chưa đặt";
  const hint = s.hint ? s.hint.slice(-2) : "";
  return hint ? `Đã đặt ••••${hint}` : "Đã đặt";
}

/** `key`: tên trường bí mật trong thân yêu cầu (telegram_bot_token, hay api_token / webhook_key của một kết nối SePay). */
export function secretPayload<K extends string>(key: K, text: string): Result<Partial<Record<K, string | null>>> {
  const v = text.trim();
  const errors: Errors = {};
  if (!v) errors.secret = "Nhập khoá mới.";
  else if (/\s/.test(v)) errors.secret = "Khoá không có khoảng trắng ở giữa.";
  return done(errors, () => ({ [key]: v }) as Partial<Record<K, string>>);
}

export const clearSecretPayload = <K extends string>(key: K): Partial<Record<K, null>> => ({ [key]: null }) as Partial<Record<K, null>>;

/** Thời gian còn lại của mã nối Zalo, "14:59"; hết hạn (hay ngày hỏng) → null. */
export function linkCodeLeft(expiresAt: string, nowMs: number): string | null {
  const s = Math.ceil((Date.parse(expiresAt) - nowMs) / 1000);
  if (!(s > 0)) return null;
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

// ── Kết nối SePay ─────────────────────────────────────────────────

export interface SepayConnectionForm {
  name: string;
  active: boolean;
  /** Chỉ dùng khi thêm: để trống là chưa đặt, đặt sau ở hàng Token API / Khoá webhook. */
  api_token: string;
  webhook_key: string;
}

/** Thêm: tên + khoá nếu có. Sửa: chỉ gửi tên/trạng thái đã đổi (khoá sửa riêng ở sheet khoá). */
export function sepayConnectionPayload(f: SepayConnectionForm, existing: { name: string; active: boolean } | null): Result<Record<string, unknown>> {
  const errors: Errors = {};
  const name = f.name.trim();
  if (!name) errors.name = "Nhập tên kết nối.";
  const token = f.api_token.trim();
  const key = f.webhook_key.trim();
  if (!existing) {
    if (/\s/.test(token)) errors.api_token = "Token không có khoảng trắng ở giữa.";
    if (/\s/.test(key)) errors.webhook_key = "Khoá không có khoảng trắng ở giữa.";
  }
  return done(errors, () => {
    if (!existing) return { name, ...(token ? { api_token: token } : {}), ...(key ? { webhook_key: key } : {}) };
    return { ...(name !== existing.name ? { name } : {}), ...(f.active !== existing.active ? { active: f.active } : {}) };
  });
}

/** Số ngày tối đa một lần đồng bộ lại (tính cả hai đầu), như server. */
const SYNC_MAX_DAYS = 31;

/** Kiểm tra khoảng ngày đồng bộ lại SePay trước khi gửi (ngày VN `YYYY-MM-DD`); server vẫn kiểm lại. null = hợp lệ. */
export function syncRangeError(from: string, to: string, today: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return "Chọn đủ ngày bắt đầu và ngày kết thúc.";
  if (from > to) return "Ngày bắt đầu phải trước hoặc trùng ngày kết thúc.";
  if (to > today) return "Chưa tới ngày kết thúc — chọn đến hôm nay là xa nhất.";
  const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000 + 1;
  if (days > SYNC_MAX_DAYS) return `Mỗi lần đồng bộ tối đa ${SYNC_MAX_DAYS} ngày — chia thành nhiều lần.`;
  return null;
}

// ── Cách nạp (allocation) ─────────────────────────────────────────

export const MODE_LABEL: Record<AllocationMode, string> = {
  flat: "Cố định mỗi kỳ",
  percent: "Theo % khoản thu",
  goal: "Mục tiêu có hạn",
  lump: "Một cục mỗi tháng",
  remainder: "Nhận phần còn lại",
};

export interface AllocForm {
  mode: AllocationMode | "none";
  period: "week" | "month";
  amount: number;
  /** Chữ người dùng gõ, đơn vị %: "30", "12,5". */
  percent: string;
  target_amount: number;
  target_date: string;
  floor_amount: number;
  priority: string;
}

/** 0.3 → "30", 0.125 → "12,5". */
export const formatPercent = (fraction: number): string => String(Math.round(fraction * 10000) / 100).replace(".", ",");

/** "12,5" / "12.5" / "30%" → 12.5; không đọc được → null. */
export function parsePercent(text: string): number | null {
  const t = text.trim().replace("%", "").replace(",", ".").trim();
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  return Number(t);
}

export function allocToForm(a: Allocation | null): AllocForm {
  if (!a) return { mode: "none", period: "month", amount: 0, percent: "", target_amount: 0, target_date: "", floor_amount: 0, priority: "100" };
  return {
    mode: a.mode,
    period: a.period ?? "month",
    amount: a.amount ?? (a.mode === "lump" ? (a.target_amount ?? 0) : 0),
    percent: a.percent !== null ? formatPercent(a.percent) : "",
    target_amount: a.target_amount ?? 0,
    target_date: a.target_date ?? "",
    floor_amount: a.floor_amount ?? 0,
    priority: String(a.priority),
  };
}

/**
 * Form → thân `allocation`. Chỉ giữ các cột mode đó dùng, cột khác về null để không sót số cũ:
 * flat = số mỗi tuần/tháng (+ sàn) · percent = phân số của khoản thu · goal = số mục tiêu + hạn ·
 * lump = một cục mỗi tháng (amount và target_amount cùng số như seed, + sàn) · remainder = không số.
 */
export function allocFormToPayload(f: AllocForm): Result<Allocation | null> {
  if (f.mode === "none") return { ok: true, value: null };
  const errors: Errors = {};
  const mode = f.mode;
  const priority = parseInteger(f.priority, 0, 9999);
  if (priority === null) errors.priority = "Ưu tiên là số nguyên từ 0 đến 9999.";
  const out: Allocation = { mode, period: "month", amount: null, percent: null, target_amount: null, target_date: null, floor_amount: null, priority: priority ?? 0 };

  if (mode === "flat") {
    if (f.amount <= 0) errors.amount = "Nhập số tiền mỗi kỳ.";
    out.period = f.period;
    out.amount = f.amount;
    out.floor_amount = f.floor_amount || null;
    if (f.floor_amount > f.amount && f.amount > 0) errors.floor_amount = "Sàn không lớn hơn số mỗi kỳ.";
  } else if (mode === "percent") {
    const p = parsePercent(f.percent);
    if (p === null || p <= 0 || p > 100) errors.percent = "Phần trăm lớn hơn 0 và không quá 100.";
    else out.percent = Math.round(p * 10000) / 1_000_000;
  } else if (mode === "goal") {
    if (f.target_amount <= 0) errors.target_amount = "Nhập số tiền mục tiêu.";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f.target_date)) errors.target_date = "Chọn hạn phải đủ tiền.";
    out.target_amount = f.target_amount;
    out.target_date = f.target_date;
  } else if (mode === "lump") {
    if (f.amount <= 0) errors.amount = "Nhập số tiền mỗi tháng.";
    out.amount = f.amount;
    out.target_amount = f.amount;
    out.floor_amount = f.floor_amount || null;
    if (f.floor_amount > f.amount && f.amount > 0) errors.floor_amount = "Sàn không lớn hơn số mỗi tháng.";
  }
  return done(errors, () => out);
}

/** Một dòng tóm tắt cách nạp cho danh sách ví. */
export function allocationSummary(a: Allocation | null): string {
  if (!a) return "chưa có số nạp";
  const floor = a.floor_amount ? ` · sàn ${formatVnd(a.floor_amount)}` : "";
  switch (a.mode) {
    case "flat":
      return `${formatVnd(a.amount ?? 0)}/${a.period === "week" ? "tuần" : "tháng"}${floor}`;
    case "percent":
      return `${formatPercent(a.percent ?? 0)}% mỗi khoản thu`;
    case "goal":
      return `đủ ${formatVnd(a.target_amount ?? 0)} trước ${a.target_date ? a.target_date.split("-").reverse().join("/") : "—"}`;
    case "lump":
      return `${formatVnd(a.amount ?? a.target_amount ?? 0)}/tháng, một cục${floor}`;
    case "remainder":
      return "nhận phần còn lại";
  }
}

// ── Ví ─────────────────────────────────────────────────────────────

export const TIER_GROUPS: { key: string; label: string; lock: boolean; match: (w: SettingsWallet) => boolean }[] = [
  { key: "wealth_building", label: "Tích sản", lock: true, match: (w) => w.tier === "wealth_building" },
  { key: "tax", label: "Thuế", lock: true, match: (w) => w.tier === "tax" },
  { key: "nice", label: "Hưởng thụ", lock: false, match: (w) => w.tier === "nice" },
  { key: "must", label: "Must", lock: false, match: (w) => w.tier === "must" && w.must_group !== "have" },
  { key: "have", label: "Có thì tốt", lock: false, match: (w) => w.tier === "must" && w.must_group === "have" },
  { key: "reserve", label: "Quỹ giữ riêng", lock: false, match: (w) => w.tier === "holding" && w.kind !== "holding" },
  { key: "holding", label: "Ví nhận tiền về", lock: false, match: (w) => w.tier === "holding" && w.kind === "holding" },
];

/** Ví theo tầng, trong tầng theo `sort`; bỏ nhóm rỗng. */
export function groupWallets(wallets: SettingsWallet[]): { key: string; label: string; lock: boolean; wallets: SettingsWallet[] }[] {
  return TIER_GROUPS.map((g) => ({ key: g.key, label: g.label, lock: g.lock, wallets: wallets.filter(g.match).sort((a, b) => a.sort - b.sort) })).filter(
    (g) => g.wallets.length > 0,
  );
}

export interface WalletForm {
  name: string;
  tier: SettingsWallet["tier"];
  must_group: "must" | "have";
  kind: SettingsWallet["kind"];
  scope: SettingsWallet["scope"];
  member_id: string;
  account_id: string;
  private: boolean;
  active: boolean;
  alloc: AllocForm;
  /** Phong bì tháng chia đều theo tuần (allocations.split_weekly). */
  split_weekly: boolean;
}

/** Chia đều theo tuần chỉ có nghĩa với phong bì nạp một số mỗi tháng. */
export const canSplitWeekly = (kind: SettingsWallet["kind"], a: AllocForm): boolean =>
  kind === "envelope" && ((a.mode === "flat" && a.period === "month") || a.mode === "lump");

export function walletToForm(w: SettingsWallet | null): WalletForm {
  if (!w) {
    return { name: "", tier: "must", must_group: "must", kind: "envelope", scope: "shared", member_id: "", account_id: "", private: false, active: true, alloc: allocToForm(null), split_weekly: false };
  }
  return {
    name: w.name,
    tier: w.tier,
    must_group: w.must_group ?? "must",
    kind: w.kind,
    scope: w.scope,
    member_id: w.member_id ?? "",
    account_id: w.account_id ?? "",
    private: w.private,
    active: w.active,
    alloc: allocToForm(w.allocation),
    split_weekly: w.allocation?.splitWeekly ?? false,
  };
}

/** Thân POST (existing = null) hoặc PATCH. Ví nhận phần còn lại không gửi `allocation`: cách nạp của nó không đổi được. */
export function walletPayload(f: WalletForm, existing: SettingsWallet | null): Result<Record<string, unknown>> {
  const errors: Errors = {};
  const name = f.name.trim();
  if (!name) errors.name = "Nhập tên ví.";
  const scope = existing ? existing.scope : f.scope;
  if (scope === "personal" && !f.member_id) errors.member_id = "Chọn người dùng ví riêng này.";
  const keepsRemainder = existing?.allocation?.mode === "remainder";
  if (!existing && f.alloc.mode === "remainder") errors.mode = "Chỉ một ví nhận phần còn lại.";
  const alloc = keepsRemainder ? null : allocFormToPayload(f.alloc);
  if (alloc && !alloc.ok) Object.assign(errors, alloc.errors);

  return done(errors, () => {
    const common: Record<string, unknown> = {
      name,
      account_id: f.account_id || null,
      member_id: scope === "personal" ? f.member_id : null,
      private: scope === "personal" ? f.private : false,
    };
    const parsed = alloc && alloc.ok ? alloc.value : null;
    const allocation = parsed ? { ...parsed, split_weekly: canSplitWeekly(existing ? existing.kind : f.kind, f.alloc) && f.split_weekly } : null;
    if (existing) return { ...common, active: f.active, ...(keepsRemainder || !allocation ? {} : { allocation }) };
    return { ...common, tier: f.tier, must_group: f.tier === "must" ? f.must_group : null, kind: f.kind, scope, allocation };
  });
}

// ── Tài khoản ─────────────────────────────────────────────────────

export const ACCOUNT_KIND_LABEL: Record<SettingsAccount["kind"], string> = { bank: "Ngân hàng", cash: "Tiền mặt", ewallet: "Ví điện tử", credit: "Thẻ tín dụng" };

/** Tên hiển thị của ngân hàng; mã ngoài danh mục (ví điện tử, tên cũ gõ tay) giữ nguyên. */
export const bankName = (code: string | null): string | null => bankByCode(code)?.name ?? code;

/** Nhãn SePay ở danh sách tài khoản: chiều tiền nào tự về; nhà có từ hai kết nối thì kèm tên kết nối. */
export function sepayLabel(a: Pick<SettingsAccount, "sepay_enabled" | "sepay_out">, connection?: string | null): string | null {
  if (!a.sepay_enabled) return null;
  const flow = a.sepay_out ? "SePay: vào + ra" : "SePay: vào";
  return connection ? `${flow} · ${connection}` : flow;
}

/**
 * Ô "Nối qua" ở sheet tài khoản: hiện khi có từ hai kết nối đang bật (một kết nối thì server tự dùng nó), hoặc khi
 * kết nối đã lưu của tài khoản (`saved`) đang tắt — giữ nó trong danh sách và chọn sẵn, để lưu ô khác không lặng lẽ
 * chuyển tài khoản sang kết nối chính. `current`: lựa chọn đang có trên form. Không có thì chọn kết nối chính.
 */
export function connectionPicker(connections: SepayConnection[], current: string, saved: string): { options: SepayConnection[]; value: string } | null {
  const active = connections.filter((c) => c.active);
  const savedOff = connections.find((c) => c.id === saved && !c.active);
  if (active.length < 2 && !savedOff) return null;
  const options = savedOff ? [...active, savedOff] : active;
  const value = [current, DEFAULT_SEPAY_CONNECTION_ID].find((id) => options.some((c) => c.id === id)) ?? options[0]!.id;
  return { options, value };
}

/** Khả năng SePay của ngân hàng theo tài liệu SePay — hiện dưới ô chọn ngân hàng. */
export function bankHint(code: string): string | null {
  const bank = bankByCode(code);
  if (!bank) return null;
  if (!bank.sepay) return "SePay chưa hỗ trợ — ghi tay.";
  const flow = bank.sepay.out ? "SePay: báo cả tiền vào lẫn tiền ra." : "SePay: báo tiền vào, chưa báo tiền ra — khoản chi từ tài khoản này nhập tay.";
  return bank.sepay.vaRequired ? `${flow} SePay chỉ nhận qua tài khoản ảo (VA) — nhập số VA ở ô Tài khoản ảo.` : flow;
}

/** Lời dặn dưới ô "SePay báo cả tiền ra": tài liệu SePay nói gì về chiều ra của ngân hàng này. */
export function sepayOutHint(code: string): string {
  const bank = bankByCode(code);
  const name = bank?.name ?? "ngân hàng này";
  if (!bank?.sepay) return `${name} không có trong danh sách ngân hàng SePay hỗ trợ.`;
  return bank.sepay.out
    ? `Theo SePay, ${name} báo cả tiền ra. Tắt nếu đã thử chuyển tiền ra mà không thấy về app.`
    : `Theo SePay, ${name} chỉ báo tiền vào. Chỉ bật khi đã thử chuyển tiền ra và thấy về app.`;
}

/** Mặc định của "SePay báo cả tiền ra" khi bật SePay hoặc đổi ngân hàng: theo tài liệu SePay. */
export const sepayOutDefault = (code: string): boolean => bankByCode(code)?.sepay?.out ?? false;

export interface AccountForm {
  name: string;
  kind: SettingsAccount["kind"];
  /** Ngân hàng/thẻ: mã trong danh mục (src/domain/banks.ts). Ví điện tử: tên nhà cung cấp tự do. */
  bank: string;
  account_no: string;
  sub_account: string;
  sepay_enabled: boolean;
  sepay_out: boolean;
  /** "" = không gửi, server tự chọn (kết nối chính khi bật SePay). */
  sepay_connection_id: string;
  owner_member_id: string;
  opening_balance: number;
  opened_at: string;
  active: boolean;
  /** "Tính vào tiền chi được" (ADR-85). Thêm mới: bật, thẻ tín dụng và tài khoản Tích sản tắt (`spendableDefault`). Tài khoản khóa luôn tắt. */
  spendable: boolean;
  /** Tài khoản Tích sản (ADR-88): null thường · phao · sổ tiết kiệm (chỉ khi thêm) · heo (chỉ migration, không đổi). */
  role: SettingsAccount["role"];
}

export function accountToForm(a: SettingsAccount | null): AccountForm {
  if (!a) return { name: "", kind: "bank", bank: "", account_no: "", sub_account: "", sepay_enabled: false, sepay_out: false, sepay_connection_id: "", owner_member_id: "", opening_balance: 0, opened_at: "", active: true, spendable: true, role: null };
  return {
    name: a.name,
    kind: a.kind,
    bank: a.bank ?? "",
    account_no: a.account_no ?? "",
    sub_account: a.sub_account ?? "",
    sepay_enabled: a.sepay_enabled,
    sepay_out: a.sepay_out,
    sepay_connection_id: a.sepay_connection_id ?? "",
    owner_member_id: a.owner_member_id ?? "",
    opening_balance: a.opening_balance,
    opened_at: a.opened_at ?? "",
    active: a.active,
    spendable: a.spendable && !a.locked,
    role: a.role,
  };
}

/** Mặc định của "Tính vào tiền chi được" khi thêm tài khoản: thẻ tín dụng (số dư là nợ — ADR-85) và tài khoản Tích sản (tiền để dành — ADR-88) tắt. */
export const spendableDefault = (kind: AccountForm["kind"], role: AccountForm["role"]): boolean => kind !== "credit" && role === null;

/**
 * `existing` = tài khoản đang sửa (null khi thêm). Như server, "SePay chưa hỗ trợ ngân hàng này" chỉ chặn khi bật SePay
 * hoặc đổi ngân hàng/loại — tài khoản cũ đã nối SePay trước khi có danh mục vẫn sửa tên được.
 */
export function accountPayload(f: AccountForm, existing: SettingsAccount | null): Result<Record<string, unknown>> {
  const errors: Errors = {};
  const name = f.name.trim();
  if (!name) errors.name = "Nhập tên tài khoản.";
  const accountNo = f.account_no.replace(/\s/g, "");
  if (accountNo && !/^[0-9A-Za-z]+$/.test(accountNo)) errors.account_no = "Số tài khoản chỉ gồm chữ số (và chữ cái nếu ngân hàng cấp).";
  if (f.sepay_enabled && f.kind !== "bank") errors.sepay_enabled = "SePay chỉ nối được tài khoản ngân hàng.";
  else if (f.sepay_enabled && !bankByCode(f.bank)?.sepay && (!existing?.sepay_enabled || f.bank !== (existing.bank ?? "") || f.kind !== existing.kind)) errors.sepay_enabled = "SePay chưa hỗ trợ ngân hàng này.";
  else if (f.sepay_enabled && !accountNo) errors.account_no = "SePay khớp giao dịch theo số tài khoản — nhập số tài khoản.";
  const cash = f.kind === "cash";
  // Heo đất và sổ tiết kiệm khóa: không bao giờ tính vào tiền chi được — server cũng chặn (locked_account).
  const locked = f.role === "term_deposit" || f.role === "piggy_bank";
  return done(errors, () => ({
    name,
    kind: f.kind,
    bank: cash ? null : orNull(f.bank),
    account_no: cash ? null : accountNo || null,
    sub_account: cash || !f.sepay_enabled ? null : orNull(f.sub_account),
    sepay_enabled: f.sepay_enabled,
    sepay_out: f.sepay_enabled && f.sepay_out,
    ...(f.sepay_enabled && f.sepay_connection_id ? { sepay_connection_id: f.sepay_connection_id } : {}),
    owner_member_id: f.owner_member_id || null,
    opening_balance: f.opening_balance,
    opened_at: f.opened_at || null,
    ...(existing ? { active: f.active } : {}),
    spendable: f.spendable && !locked,
    // Heo đất và sổ tiết kiệm giữ vai trò từ lúc tạo: sửa thì không gửi (server chỉ cho đổi thường ↔ phao — ADR-88).
    ...(existing?.locked ? {} : { role: f.role }),
  }));
}

// ── Mã chuyển khoản (rule) ────────────────────────────────────────

export const MATCH_LABEL: Record<Rule["match_type"], string> = { code: "Mã", content: "Từ khoá", account: "Số tài khoản" };
export const MEANING_LABEL: Record<Rule["meaning"], string> = { spend: "Khoản chi", transfer: "Chuyển nội bộ", income: "Thu nhập (lương)" };

/** Quy ước mã của nhà: ba ký tự, bắt đầu bằng Q hoặc E (EXE, EMS, QTT). Lệch quy ước chỉ nhắc, không chặn. */
export const followsCodeConvention = (pattern: string): boolean => /^[QE][A-Z0-9]{2}$/.test(pattern);

/** Mẫu so khớp: bỏ dấu, viết hoa như lúc server so nội dung chuyển khoản. */
export function normalizePattern(matchType: Rule["match_type"], text: string): string {
  const t = text.trim();
  if (matchType === "account") return t.replace(/\s/g, "");
  const plain = t.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D").toUpperCase();
  return matchType === "code" ? plain.replace(/\s/g, "") : plain.replace(/\s+/g, " ");
}

export interface RuleForm {
  match_type: Rule["match_type"];
  pattern: string;
  meaning: Rule["meaning"];
  wallet_id: string;
  category_id: string;
  by_member_id: string;
  priority: string;
  active: boolean;
  /** Chỉ cho mã lương (thu nhập): nguồn thu quyết định phần khóa. */
  income_stream_id: string;
}

export function ruleToForm(r: Rule | null): RuleForm {
  if (!r) return { match_type: "code", pattern: "", meaning: "spend", wallet_id: "", category_id: "", by_member_id: "", priority: "50", active: true, income_stream_id: "" };
  return {
    match_type: r.match_type,
    pattern: r.pattern,
    meaning: r.meaning,
    wallet_id: r.wallet_id ?? "",
    category_id: r.category_id ?? "",
    by_member_id: r.by_member_id ?? "",
    priority: String(r.priority),
    active: r.active,
    income_stream_id: r.incomeStreamId ?? "",
  };
}

/** POST /v1/rules (isNew) nhận bộ trường cũ; PATCH nhận thêm người chi và bật/tắt. Thu nhập luôn là rule lương (ràng buộc DB). */
export function rulePayload(f: RuleForm, isNew: boolean): Result<Record<string, unknown>> {
  const errors: Errors = {};
  const pattern = normalizePattern(f.match_type, f.pattern);
  if (!pattern) errors.pattern = f.match_type === "code" ? "Nhập mã." : f.match_type === "content" ? "Nhập từ khoá." : "Nhập số tài khoản.";
  else if (f.match_type === "code" && !/^[A-Z0-9]{2,12}$/.test(pattern)) errors.pattern = "Mã viết liền, chỉ gồm chữ không dấu và số.";
  else if (f.match_type === "account" && !/^[0-9A-Za-z]+$/.test(pattern)) errors.pattern = "Số tài khoản chỉ gồm chữ số.";
  if (f.meaning === "spend" && !f.wallet_id) errors.wallet_id = "Khoản chi cần ví.";
  if (f.meaning === "spend" && !f.category_id) errors.category_id = "Khoản chi cần danh mục.";
  const priority = parseInteger(f.priority, 0, 9999);
  if (priority === null) errors.priority = "Ưu tiên là số nguyên từ 0 đến 9999.";
  return done(errors, () => {
    const body: Record<string, unknown> = {
      match_type: f.match_type,
      pattern,
      meaning: f.meaning,
      wallet_id: f.wallet_id || null,
      category_id: f.meaning === "spend" ? f.category_id || null : null,
      priority,
      is_salary: f.meaning === "income",
    };
    return isNew
      ? body
      : { ...body, by_member_id: f.by_member_id || null, active: f.active, income_stream_id: f.meaning === "income" ? f.income_stream_id || null : null };
  });
}

// ── Thành viên, tham số ───────────────────────────────────────────

export function memberPayload(f: { name: string; tg_chat_id: string }, current: SettingsMember): Result<{ name?: string; tg_chat_id?: string | null }> {
  const errors: Errors = {};
  const name = f.name.trim();
  if (!name) errors.name = "Nhập tên.";
  const chat = f.tg_chat_id.trim().replace("−", "-");
  if (chat && !/^-?\d{5,20}$/.test(chat)) errors.tg_chat_id = "chat_id là một dãy số (nhóm thì có dấu - ở đầu).";
  return done(errors, () => ({
    ...(name !== current.name ? { name } : {}),
    ...((chat || null) !== current.tg_chat_id ? { tg_chat_id: chat || null } : {}),
  }));
}

export function configPayload(f: { salary_min_amount: number; safety_fund_months: string }): Result<SettingsConfig> {
  const errors: Errors = {};
  const months = parseInteger(f.safety_fund_months, 1, 24);
  if (months === null) errors.safety_fund_months = "Số tháng là số nguyên từ 1 đến 24.";
  if (f.salary_min_amount < 0) errors.salary_min_amount = "Ngưỡng không âm.";
  return done(errors, () => ({ salary_min_amount: f.salary_min_amount, safety_fund_months: months! }));
}

// ── Giờ nhắc (cả nhà) ─────────────────────────────────────────────

export const WEEKDAY_LABEL: Record<number, string> = { 1: "Thứ Hai", 2: "Thứ Ba", 3: "Thứ Tư", 4: "Thứ Năm", 5: "Thứ Sáu", 6: "Thứ Bảy", 7: "Chủ nhật" };

/** Bắt đầu = kết thúc nghĩa là không đặt giờ yên lặng. */
export const quietLabel = (s: Pick<NotifySchedule, "quietStart" | "quietEnd">): string => (s.quietStart === s.quietEnd ? "Không đặt" : `${s.quietStart}–${s.quietEnd}`);

/** Các dòng tóm tắt ở thẻ Giờ nhắc. */
export function scheduleRows(s: NotifySchedule): { title: string; sub: string; value: string }[] {
  return [
    {
      title: "Tin sáng",
      sub: s.dailyEnabled ? "Còn để chi tuần này, ví sắp vỡ, đối soát, việc cần làm" : `Đang tắt — ngày 1 vẫn tự chốt tháng lúc ${s.dailyTime}, chỉ không gửi tin`,
      value: s.dailyEnabled ? s.dailyTime : "Tắt",
    },
    {
      title: "Tổng kết tuần",
      sub: "Đã tiêu so với dự kiến từng phong bì, top 5 danh mục",
      value: s.weeklyEnabled ? `${WEEKDAY_LABEL[s.weeklyDay]} ${s.weeklyTime}` : "Tắt",
    },
    {
      title: "Báo giao dịch chưa gán",
      sub: s.pendingEnabled ? "Tiền ra/vào chưa biết là gì — kiểm tra mỗi 15 phút (đêm 1–4 giờ: mỗi giờ)" : "Đang tắt — vẫn đếm trong tin sáng và ở màn Gán",
      value: s.pendingEnabled ? "Bật" : "Tắt",
    },
    {
      title: "Giờ yên lặng",
      sub: s.quietStart === s.quietEnd ? "Báo giao dịch chưa gán cả ngày lẫn đêm" : "Giao dịch chưa gán gom lại báo sáng ra",
      value: quietLabel(s),
    },
  ];
}

/** Thân PATCH /v1/settings/notify-schedule; giờ phải là bội số 15 phút vì cron chạy mỗi 15 phút (ADR-70). */
export function notifyPayload(f: NotifySchedule): Result<{
  daily_time: string;
  weekly_day: number;
  weekly_time: string;
  quiet_start: string;
  quiet_end: string;
  daily_enabled: boolean;
  weekly_enabled: boolean;
  pending_enabled: boolean;
}> {
  const errors: Errors = {};
  const clocks = { daily_time: f.dailyTime, weekly_time: f.weeklyTime, quiet_start: f.quietStart, quiet_end: f.quietEnd };
  for (const [k, v] of Object.entries(clocks)) {
    const minutes = clockMinutes(v);
    if (minutes === null || minutes % 15 !== 0) errors[k] = "Giờ phải chia hết cho 15 phút (vd 07:00, 07:15).";
  }
  if (!WEEKDAY_LABEL[f.weeklyDay]) errors.weekly_day = "Chọn một ngày trong tuần.";
  return done(errors, () => ({
    ...clocks,
    weekly_day: f.weeklyDay,
    daily_enabled: f.dailyEnabled,
    weekly_enabled: f.weeklyEnabled,
    pending_enabled: f.pendingEnabled,
  }));
}

// ── Nguồn thu ─────────────────────────────────────────────────────

export interface StreamForm {
  name: string;
  active: boolean;
  /** percent: chữ người dùng gõ, đơn vị %. */
  locks: { key: number; wallet_id: string; percent: string }[];
}

export function streamToForm(s: IncomeStream | null): StreamForm {
  if (!s) return { name: "", active: true, locks: [] };
  return { name: s.name, active: s.active, locks: s.locks.map((l, i) => ({ key: i + 1, wallet_id: l.walletId, percent: formatPercent(l.percent) })) };
}

/** Thân POST/PATCH nguồn thu. Mỗi ví khóa một lần, mỗi phần > 0 và tổng không quá 100%; khóa 100% thì không chạy dòng thác. */
export function streamPayload(f: StreamForm, isNew: boolean): Result<{ name: string; locks: { wallet_id: string; percent: number }[]; active?: boolean }> {
  const errors: Errors = {};
  const name = f.name.trim();
  if (!name) errors.name = "Nhập tên nguồn thu.";
  const seen = new Set<string>();
  let total = 0;
  const locks = f.locks.map((l, i) => {
    const p = parsePercent(l.percent);
    if (!l.wallet_id) errors[`lock-${l.key}`] = `Dòng ${i + 1}: chọn ví.`;
    else if (seen.has(l.wallet_id)) errors[`lock-${l.key}`] = `Dòng ${i + 1}: ví này đã có ở dòng trên.`;
    else if (p === null || p <= 0 || p > 100) errors[`lock-${l.key}`] = `Dòng ${i + 1}: phần trăm lớn hơn 0 và không quá 100.`;
    seen.add(l.wallet_id);
    total += p ?? 0;
    return { wallet_id: l.wallet_id, percent: Math.round((p ?? 0) * 10000) / 1_000_000 };
  });
  if (total > 100 + 1e-9) errors.locks = `Tổng phần khóa ${formatPercent(total / 100)}% — không quá 100%.`;
  return done(errors, () => ({ name, locks, ...(isNew ? {} : { active: f.active }) }));
}

/** "Tích sản 45%" · "không khóa — cả khoản vào dòng thác". */
export function streamSummary(s: IncomeStream, wallets: { id: string; name: string }[]): string {
  if (s.locks.length === 0) return "không khóa — cả khoản vào dòng thác";
  return s.locks.map((l) => `${wallets.find((w) => w.id === l.walletId)?.name ?? l.walletId} ${formatPercent(l.percent)}%`).join(" · ");
}

// ── Nhật ký thay đổi ──────────────────────────────────────────────

const AUDIT_ACTION: Record<string, string> = {
  "tx.void": "Huỷ giao dịch",
  "tx.replace": "Sửa giao dịch",
  "tx.unassign": "Gỡ gán giao dịch ngân hàng",
  "account.create": "Thêm tài khoản",
  "account.update": "Sửa tài khoản",
  "member.update": "Sửa thành viên",
  "member.zalo_code": "Tạo mã nối Zalo",
  "member.zalo_link": "Nối Zalo",
  "integrations.update": "Đổi khoá Telegram / Zalo",
  "sepay.create": "Thêm kết nối SePay",
  "sepay.update": "Sửa kết nối SePay",
  "push.add": "Thêm máy nhận thông báo",
  "push.remove": "Gỡ máy nhận thông báo",
  "session.revoke_all": "Đăng xuất mọi máy",
  "mcp.connect": "Nối ứng dụng AI",
  "mcp.revoke": "Gỡ kết nối ứng dụng AI",
  "tx.create": "Ghi giao dịch",
  "log.assign": "Gán giao dịch ngân hàng",
  "income.allocate": "Chia khoản thu",
  "tenant.paid_for_us": "Người thuê trả hộ",
};
const AUDIT_VIA: Record<AuditEntry["via"], string> = { session: "", token: " · qua API token", mcp: " · qua Claude" };

/**
 * Một dòng "Nhật ký thay đổi": `title` = việc + đối tượng ("Huỷ giao dịch #12", "Thêm máy nhận thông báo: iPhone · Safari"),
 * `sub` = ai, qua đâu, lúc nào; `fields` = tên trường đã đổi (nếu có).
 */
export function auditView(e: AuditEntry): { title: string; sub: string; fields: string | null } {
  const colon = e.target ? e.target.indexOf(":") : -1;
  const kind = e.target && colon > 0 ? e.target.slice(0, colon) : null;
  const id = e.target && colon > 0 ? e.target.slice(colon + 1) : e.target;
  const device = typeof e.detail?.device === "string" ? e.detail.device : null;
  const object = kind === "tx" || kind === "log" ? ` #${id}` : kind === "push" ? `: ${device ?? "máy không rõ"}` : kind === "client" ? `: ${id}` : id ? ` ${id}` : "";
  const fields = [e.detail?.fields, e.detail?.set, e.detail?.cleared].flatMap((v) => (Array.isArray(v) ? v.map(String) : []));
  const iso = sqliteUtcToIso(e.at);
  return {
    title: `${AUDIT_ACTION[e.action] ?? e.action}${object}`,
    sub: `${e.memberName ?? "Không rõ ai"}${AUDIT_VIA[e.via]} · ${timeHM(iso)} ${shortDate(iso)}`,
    fields: fields.length ? `đổi: ${fields.join(", ")}` : null,
  };
}
