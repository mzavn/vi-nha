// Logic thuần của màn Cài đặt: kiểm tra form, đổi form ↔ thân yêu cầu, hiện bí mật chỉ-ghi.
// Không đụng DOM hay mạng để test được bằng vitest.

import type { AuditAction } from "../../../src/domain/audit-actions";
import { bankByCode } from "../../../src/domain/banks";
import { DEFAULT_SAVINGS_PCT, goalGroups, type PocketGoalInput } from "../../../src/domain/pockets";
import { INTEREST_MAX_AMOUNT_LIMIT } from "../../../src/domain/interest-deposit";
import { clockMinutes } from "../../../src/domain/notify-schedule";
import { DEFAULT_SEPAY_CONNECTION_ID } from "../../../src/domain/system-ids";
import { ApiError, errorText } from "./api";
import { formatVnd, moneyDigits } from "./money";
import { dueText, groupAccountsByPocket, nextDueDate, type PocketChoice } from "./pockets";
import { sqliteUtcToIso } from "./push";
import { dayKey, shortDate, timeHM } from "./period";
import type { AuditEntry, Debt, IncomeStream, NotifySchedule, Pocket, ReserveGoal, Rule, Secret, SepayConnection, SepaySyncResult, SettingsAccount, SettingsConfig, SettingsData, SettingsMember } from "./types";

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
  else if (/\s/.test(v)) errors.secret = "Khoá không có dấu cách ở giữa.";
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
    if (/\s/.test(token)) errors.api_token = "Token không có dấu cách ở giữa.";
    if (/\s/.test(key)) errors.webhook_key = "Khoá không có dấu cách ở giữa.";
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
  if (to > today) return "Chưa tới ngày kết thúc, chọn đến hôm nay là xa nhất.";
  const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000 + 1;
  if (days > SYNC_MAX_DAYS) return `Mỗi lần lấy tối đa ${SYNC_MAX_DAYS} ngày, chia thành nhiều lần.`;
  return null;
}

/**
 * Câu toast sau Đồng bộ lại (UC-304): giao dịch trước ngày mở sổ (đã trong số dư đầu, ADR-76) và trước mốc theo dõi SePay
 * (đã có trong sổ, ADR-113) đếm riêng; kết nối lỗi thì nói, không chỉ "Đã lấy thêm 0 giao dịch" như thể xong xuôi.
 */
export function sepaySyncText(r: SepaySyncResult): string {
  const early = r.beforeOpening > 0 ? ` ${r.beforeOpening} giao dịch trước ngày mở sổ, đã có trong số dư đầu, không ghi lại.` : "";
  const beforeFeed = r.beforeFeed > 0 ? ` ${r.beforeFeed} giao dịch trước mốc theo dõi SePay, đã có trong sổ, không ghi lại.` : "";
  const failed = r.errors.length > 0 ? " Có chỗ chưa lấy được, xem lý do dưới nút Đồng bộ." : "";
  return `Đã lấy thêm ${r.added} giao dịch, ${r.duplicates} đã có sẵn.${early}${beforeFeed}${failed}`;
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
  if (!bank.sepay) return "SePay chưa hỗ trợ, ghi tay.";
  const flow = bank.sepay.out ? "SePay: báo cả tiền vào lẫn tiền ra." : "SePay: báo tiền vào, chưa báo tiền ra, khoản chi từ tài khoản này nhập tay.";
  return bank.sepay.vaRequired ? `${flow} SePay chỉ nhận qua tài khoản ảo (VA), nhập số VA ở ô Tài khoản ảo.` : flow;
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

/**
 * "SePay theo dõi từ" (ADR-113): `enabled` lúc bật (không gửi — server đặt mốc lúc bật khi sổ đã có dữ liệu của tài khoản) ·
 * `opening` ngày số dư đầu (lấy lịch sử, gửi null) · `time` giờ tuỳ chọn (`feed_from`).
 */
export type FeedMode = "enabled" | "opening" | "time";

/** ISO → giá trị ô datetime-local theo giờ VN, đủ giây ("2026-10-15T22:25:07"). */
export function vnDateTimeInput(iso: string): string {
  return iso ? new Date(Date.parse(iso) + 7 * 3600_000).toISOString().slice(0, 19) : "";
}

/** Giá trị ô datetime-local (giờ VN, có hoặc không có giây) → ISO; sai → "". */
export function isoFromVnInput(v: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(v)) return "";
  const t = Date.parse(`${v.length === 16 ? `${v}:00` : v}+07:00`);
  return Number.isNaN(t) ? "" : new Date(t).toISOString();
}

/**
 * Gợi ý đặt mốc theo dõi (UC-709): tài khoản đã nối SePay, chưa có mốc, mà log SePay sớm nhất rơi sau ngày số dư đầu — có
 * vẻ nối SePay sau khi đã dùng. Trả đúng `at` của log đó (đặt mốc bằng nó thì chính log ấy vẫn trong phạm vi); còn lại null.
 */
export function feedFromSuggestion(a: SettingsAccount | null): string | null {
  if (!a?.sepay_enabled || a.feed_from || !a.first_log_at || !a.opened_at) return null;
  return dayKey(a.first_log_at) > a.opened_at ? a.first_log_at : null;
}

/** Mốc dưới dạng người đọc: "22:25 15/10". */
export const feedFromText = (iso: string): string => `${timeHM(iso)} ${shortDate(iso)}`;

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
  feed_mode: FeedMode;
  /** ISO của giờ tuỳ chọn (`feed_mode` = `time`); "" = chưa chọn. */
  feed_from: string;
  active: boolean;
  /** Ngăn (UC-1201); null = ngoài ngăn. Thêm mới mặc định Vận hành (như server khi không gửi `pocket`). */
  pocket: Pocket | null;
  /** Người dùng đã tự chọn ngăn: thêm mới chỉ gửi `pocket` khi đã chọn, còn không server đặt Vận hành (chưa xác nhận). */
  pocket_touched: boolean;
  /** "Riêng tư — người khác chỉ thấy tổng" (UC-504, UC-709); chỉ chủ tài khoản đổi được. */
  private: boolean;
  /** Tài khoản mẹ khi đây là khoản gửi kỳ hạn (ADR-140); "" = không thuộc tài khoản nào. */
  parent_account_id: string;
}

export function accountToForm(a: SettingsAccount | null): AccountForm {
  if (!a)
    return { name: "", kind: "bank", bank: "", account_no: "", sub_account: "", sepay_enabled: false, sepay_out: false, sepay_connection_id: "", owner_member_id: "", opening_balance: 0, opened_at: "", feed_mode: "enabled", feed_from: "", active: true, pocket: "operating", pocket_touched: false, private: false, parent_account_id: "" };
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
    // Đã nối: có mốc thì là giờ đó, chưa có là từ ngày số dư đầu. Chưa nối: bật lúc này thì mặc định Lúc bật.
    feed_mode: a.feed_from ? "time" : a.sepay_enabled ? "opening" : "enabled",
    feed_from: a.feed_from ?? "",
    active: a.active,
    pocket: a.pocket ?? null,
    pocket_touched: false,
    private: a.private ?? false,
    parent_account_id: a.parent_account_id ?? "",
  };
}

/**
 * Công tắc "Riêng tư — người khác chỉ thấy tổng" ở sheet tài khoản (UC-709 AC-44): chỉ khi tài khoản đã có (không phải thêm
 * mới), có chủ và người đang xem là chủ.
 */
export function canSetPrivate(a: Pick<SettingsAccount, "owner_member_id"> | null, viewerId: string | null): boolean {
  return !!a && !!a.owner_member_id && a.owner_member_id === viewerId;
}

/**
 * Ô Chủ tài khoản ở sheet tài khoản (UC-709 AC-47): tài khoản riêng tư có chủ mà người xem không phải chủ → chỉ đọc, không gửi
 * `owner_member_id` (server: 403 `not_owner`, access UC-504 AC-10). Thêm mới / tài khoản công khai: ai cũng chọn được.
 */
export function canSetOwner(a: Pick<SettingsAccount, "owner_member_id" | "private"> | null, viewerId: string | null): boolean {
  return !a?.private || !a.owner_member_id || a.owner_member_id === viewerId;
}

/**
 * Lỗi khi lưu tài khoản thuộc ô nào: đổi ngày mở sổ về sau giao dịch sớm nhất (409 `opening_after_entries`, access UC-506 AC-24)
 * hiện ngay dưới ô ngày, nguyên câu server nói (ngày giao dịch sớm nhất, việc cần làm); mốc theo dõi SePay sai (UC-506 AC-25)
 * hiện dưới ô mốc. Lỗi khác hiện trên nút như cũ.
 */
export function accountSubmitError(err: unknown): { field: string | null; message: string } {
  if (err instanceof ApiError && err.code === "opening_after_entries") return { field: "opened_at", message: err.message };
  if (err instanceof ApiError && err.field === "feed_from") return { field: "feed_from", message: err.message };
  return { field: null, message: errorText(err) };
}

/**
 * `existing` = tài khoản đang sửa (null khi thêm). Như server, "SePay chưa hỗ trợ ngân hàng này" chỉ chặn khi bật SePay
 * hoặc đổi ngân hàng/loại — tài khoản cũ đã nối SePay trước khi có danh mục vẫn sửa tên được. `viewerId`: người đang xem —
 * chỉ chủ tài khoản gửi `private`; tài khoản riêng tư của người khác không gửi `owner_member_id` (server: 403 `not_owner`).
 * Khoản gửi kỳ hạn (`parent_account_id`, ADR-140): không SePay; không gửi `pocket` / `private` / `owner_member_id` — con
 * luôn theo mẹ (server 400 `pocket_follows_parent` khi lệch). `parent_account_id` chỉ gửi khi thêm / đổi; bỏ mẹ gửi null.
 */
export function accountPayload(f: AccountForm, existing: SettingsAccount | null, viewerId: string | null = null): Result<Record<string, unknown>> {
  const errors: Errors = {};
  const name = f.name.trim();
  if (!name) errors.name = "Nhập tên tài khoản.";
  const accountNo = f.account_no.replace(/\s/g, "");
  if (accountNo && !/^[0-9A-Za-z]+$/.test(accountNo)) errors.account_no = "Số tài khoản chỉ gồm chữ số (và chữ cái nếu ngân hàng cấp).";
  const parent = f.parent_account_id || null;
  const wasChild = !!existing?.parent_account_id;
  if (parent && f.kind !== "bank") errors.parent_account_id = "Khoản gửi kỳ hạn là tài khoản ngân hàng.";
  const sepay = f.sepay_enabled && !parent;
  if (sepay && f.kind !== "bank") errors.sepay_enabled = "SePay chỉ nối được tài khoản ngân hàng.";
  else if (sepay && !bankByCode(f.bank)?.sepay && (!existing?.sepay_enabled || f.bank !== (existing.bank ?? "") || f.kind !== existing.kind)) errors.sepay_enabled = "SePay chưa hỗ trợ ngân hàng này.";
  else if (sepay && !accountNo) errors.account_no = "Nhập số tài khoản để SePay khớp giao dịch.";
  // Mốc theo dõi chỉ gửi khi sửa tài khoản đang / sắp nối SePay; tài khoản mới chưa có gì trong sổ để trùng.
  const feed = existing && sepay && f.kind === "bank" ? f.feed_mode : null;
  if (feed === "time" && !f.feed_from) errors.feed_from = "Chọn giờ bắt đầu theo dõi.";
  const cash = f.kind === "cash";
  const follows = !!parent || wasChild;
  return done(errors, () => ({
    name,
    kind: f.kind,
    bank: cash ? null : orNull(f.bank),
    account_no: cash ? null : accountNo || null,
    sub_account: cash || !sepay ? null : orNull(f.sub_account),
    sepay_enabled: sepay,
    sepay_out: sepay && f.sepay_out,
    ...(sepay && f.sepay_connection_id ? { sepay_connection_id: f.sepay_connection_id } : {}),
    ...(!follows && canSetOwner(existing, viewerId) ? { owner_member_id: f.owner_member_id || null } : {}),
    opening_balance: f.opening_balance,
    opened_at: f.opened_at || null,
    ...(feed === "opening" ? { feed_from: null } : feed === "time" ? { feed_from: f.feed_from } : {}),
    ...(existing ? { active: f.active } : {}),
    // Không bao giờ gửi `spendable` / `role` / `locked` (bỏ ở v2, server trả 400 `model_changed`).
    // Sửa thì luôn gửi ngăn (lưu là xác nhận); bản cài đặt cũ chưa có ngăn thì chỉ gửi khi người dùng chọn. Con theo mẹ: không gửi.
    ...(!follows && (f.pocket_touched || (existing && existing.pocket !== undefined)) ? { pocket: f.pocket } : {}),
    ...(!follows && canSetPrivate(existing, viewerId) && f.private !== (existing?.private ?? false) ? { private: f.private } : {}),
    ...(parent !== (existing?.parent_account_id ?? null) ? { parent_account_id: parent } : {}),
  }));
}

// ── Khoản gửi kỳ hạn: tài khoản con (ADR-140, pwa UC-709 AC-51) ──────

/** Lý do ô "Thuộc tài khoản" tắt (server: E14 / `invalid_parent`). */
export const PARENT_SEPAY = "Tài khoản đang nối SePay: khoản gửi kỳ hạn không có số báo riêng, tắt SePay trước.";
export const PARENT_REWARD = "Ví Thưởng không là khoản gửi kỳ hạn.";

export const accountParentHint = (parent: string): string => `Khoản gửi kỳ hạn mở từ tài khoản này. Tiền vẫn tính là của ${parent}; mục tiêu gắn ${parent} thấy cả khoản này.`;

/** Chữ ở ô Ngăn của tài khoản con (sheet tài khoản, sheet xếp ngăn). */
export const parentPocketText = (parent: string): string => `theo ${parent}`;

/** Tài khoản đang có con đang dùng (là mẹ). */
const hasChildren = (accountId: string, accounts: SettingsAccount[]) => accounts.some((a) => a.active && a.parent_account_id === accountId);

/**
 * Ô "Thuộc tài khoản" (ngoài "Không"): tài khoản ngân hàng đang dùng ở Dự phòng, Tích luỹ hoặc ngoài ngăn (không Vận hành),
 * không phải tài khoản con, không phải chính tài khoản đang sửa. Ví Thưởng làm mẹ được (access UC-506 3n, ADR-140).
 */
export function accountParentOptions(accounts: SettingsAccount[], item: SettingsAccount | null): SettingsAccount[] {
  return accounts.filter((a) => a.active && a.kind === "bank" && a.pocket !== "operating" && !a.parent_account_id && a.id !== item?.id);
}

/**
 * Ô "Thuộc tài khoản" của sheet: tài khoản đang là mẹ → không có ô; tài khoản đang nối SePay / gắn mục tiêu / là Ví Thưởng
 * → ô tắt kèm lý do (server: E14, 409 `goal_on_child`, 400 `invalid_parent`). Ô chỉ hiện với tài khoản ngân hàng (sheet tự xét).
 */
export function accountParentField(item: SettingsAccount | null, accounts: SettingsAccount[], goals: ReserveGoal[], rewardAccountId: string | null | undefined): { show: boolean; disabled: string | null } {
  if (!item) return { show: true, disabled: null };
  if (hasChildren(item.id, accounts)) return { show: false, disabled: null };
  const names = accountGoals(item.id, goals).map((g) => g.name);
  const disabled = item.sepay_enabled ? PARENT_SEPAY : names.length ? `Tài khoản của mục tiêu ${names.join(", ")}: bỏ gắn mục tiêu trước.` : item.id === rewardAccountId ? PARENT_REWARD : null;
  return { show: true, disabled };
}

/** Nút "+ Thêm khoản gửi kỳ hạn" ở sheet của một tài khoản: chỉ khi tài khoản đó làm mẹ được (kể cả Ví Thưởng). */
export function canAddDeposit(item: SettingsAccount, accounts: SettingsAccount[]): boolean {
  return accountParentOptions(accounts, null).some((a) => a.id === item.id);
}

/** Điền sẵn sheet thêm khoản gửi kỳ hạn: mẹ và ngân hàng của mẹ (ngăn / chủ / riêng tư theo mẹ, không gửi). */
export function depositPreset(parent: SettingsAccount): Partial<AccountForm> {
  return { parent_account_id: parent.id, bank: parent.bank ?? "" };
}

/** Câu đầu sheet xếp ngăn (UC-709 rà Ba ngăn). */
export const POCKETS_SHEET_HEAD = "Tiền chi tiêu hằng ngày để ở Vận hành; tiền để dành cho khoản sắp trả ở Dự phòng; tiền không đụng ở Tích luỹ.";

/** Một nhóm ngăn của sheet xếp ngăn; mỗi dòng là tài khoản không phải con, kèm các con đang dùng của nó. */
export interface PocketSheetGroup {
  key: string;
  label: string;
  rows: { account: SettingsAccount; children: SettingsAccount[] }[];
}

/** Sheet xếp ngăn: nhóm như `groupAccountsByPocket` trên tài khoản không phải con; mỗi dòng kèm các con đang dùng ("theo {mẹ}"). */
export function pocketSheetGroups(accounts: SettingsAccount[], choice: PocketChoice): PocketSheetGroup[] {
  const children = accounts.filter((a) => a.active && a.parent_account_id);
  return groupAccountsByPocket(
    accounts.filter((a) => !a.parent_account_id),
    choice,
  ).map(({ accounts: list, ...g }) => ({ ...g, rows: list.map((a) => ({ account: a, children: children.filter((c) => c.parent_account_id === a.id) })) }));
}

/** Vị trí thanh % Tích luỹ theo chữ đang gõ: số nguyên 1–100, sai → 10 (mặc định của thang). */
export const sliderPct = (text: string): number => parseInteger(text, 1, 100) ?? DEFAULT_SAVINGS_PCT;

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
  category_id: string;
  by_member_id: string;
  priority: string;
  active: boolean;
  /** Chỉ cho mã lương (thu nhập): nguồn thu (nhắc trích Tích luỹ theo "Nguồn lương" của nguồn). */
  income_stream_id: string;
}

export function ruleToForm(r: Rule | null): RuleForm {
  if (!r) return { match_type: "code", pattern: "", meaning: "spend", category_id: "", by_member_id: "", priority: "50", active: true, income_stream_id: "" };
  return {
    match_type: r.match_type,
    pattern: r.pattern,
    meaning: r.meaning,
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
  if (f.meaning === "spend" && !f.category_id) errors.category_id = "Khoản chi cần danh mục.";
  const priority = parseInteger(f.priority, 0, 9999);
  if (priority === null) errors.priority = "Ưu tiên là số nguyên từ 0 đến 9999.";
  return done(errors, () => {
    const body: Record<string, unknown> = {
      match_type: f.match_type,
      pattern,
      meaning: f.meaning,
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
  if (chat && !/^-?\d{5,20}$/.test(chat)) errors.tg_chat_id = "chat_id là dãy số (nhóm thì có dấu - ở đầu).";
  return done(errors, () => ({
    ...(name !== current.name ? { name } : {}),
    ...((chat || null) !== current.tg_chat_id ? { tg_chat_id: chat || null } : {}),
  }));
}

type ConfigFields = "salary_min_amount" | "interest_max_amount" | "safety_fund_months" | "payday_day";

/** Trần ngưỡng nhắc trích Tích luỹ (`salary_reminder_min`, access UC-507). */
export const SALARY_REMINDER_MIN_LIMIT = 1e12;

export function configPayload(f: {
  salary_min_amount: number;
  /** Ngưỡng nhắc trích Tích luỹ (Q1-B, UC-709 AC-55); undefined = bản cài đặt cũ chưa có, không gửi. */
  salary_reminder_min?: number;
  interest_max_amount: number;
  safety_fund_months: string;
  payday_day: string;
  /** % Tích luỹ khi lương về (UC-507); undefined = bản cài đặt cũ chưa có, không gửi. */
  savings_pct?: string;
  /** Dư cuối tháng vào Tích luỹ (UC-1207); undefined = bản cài đặt cũ chưa có, không gửi. */
  surplus_savings_pct?: string;
  /** Ví Thưởng: mã tài khoản Dự phòng không gắn mục tiêu (UC-1209 bước 4); "" = chưa chọn. */
  surplus_reward_account?: string;
}): Result<Required<Pick<SettingsConfig, ConfigFields>> & { salary_reminder_min?: number; savings_pct?: number; surplus_savings_pct?: number; surplus_reward_account?: string | null }> {
  const errors: Errors = {};
  const months = parseInteger(f.safety_fund_months, 1, 24);
  if (months === null) errors.safety_fund_months = "Số tháng là số nguyên từ 1 đến 24.";
  if (f.salary_min_amount < 0) errors.salary_min_amount = "Ngưỡng không âm.";
  if (f.salary_reminder_min !== undefined && (!Number.isInteger(f.salary_reminder_min) || f.salary_reminder_min < 0 || f.salary_reminder_min > SALARY_REMINDER_MIN_LIMIT))
    errors.salary_reminder_min = "Ngưỡng là số nguyên không âm.";
  if (f.interest_max_amount < 0 || f.interest_max_amount > INTEREST_MAX_AMOUNT_LIMIT) errors.interest_max_amount = "Ngưỡng từ 0 đến 10.000.000 ₫ (0 = tắt).";
  const payday = parseInteger(f.payday_day, 1, 31);
  if (payday === null) errors.payday_day = "Ngày lương là số nguyên từ 1 đến 31.";
  const savingsPct = f.savings_pct === undefined ? undefined : parseInteger(f.savings_pct, 1, 100);
  if (savingsPct === null) errors.savings_pct = "% Tích luỹ là số nguyên từ 1 đến 100.";
  const surplusPct = f.surplus_savings_pct === undefined ? undefined : parseInteger(f.surplus_savings_pct, 0, 100);
  if (surplusPct === null) errors.surplus_savings_pct = "Phần trăm từ 0 đến 100.";
  return done(errors, () => ({
    salary_min_amount: f.salary_min_amount,
    ...(f.salary_reminder_min === undefined ? {} : { salary_reminder_min: f.salary_reminder_min }),
    interest_max_amount: f.interest_max_amount,
    safety_fund_months: months!,
    payday_day: payday!,
    ...(savingsPct === undefined ? {} : { savings_pct: savingsPct! }),
    ...(surplusPct === undefined ? {} : { surplus_savings_pct: surplusPct! }),
    ...(f.surplus_reward_account === undefined ? {} : { surplus_reward_account: orNull(f.surplus_reward_account) }),
  }));
}

// ── Mục tiêu Dự phòng gắn tài khoản thật, nhiều mục tiêu dùng chung được một tài khoản (pocket UC-1209, pwa UC-709) ──

/** Mục tiêu đang dùng gắn tài khoản này, theo thứ tự ưu tiên (thứ tự server); không có → []. */
export function accountGoals(accountId: string, goals: ReserveGoal[]): ReserveGoal[] {
  return goals.filter((g) => g.active && g.account_id === accountId);
}

/** Câu dưới ô Ngăn khi tài khoản đang gắn mục tiêu (server: 409 `account_has_goal`). */
export const GOAL_POCKET_LOCK = "Bỏ gắn mục tiêu trước khi đổi ngăn";
/** Luật Thuế (QĐ1-A): mục tiêu % không dùng chung tài khoản — câu ở ô chọn tài khoản. */
export const TAX_OWN_ACCOUNT = "Thuế cần tài khoản riêng";
/** 409 `tax_account_shared`. */
export const TAX_ACCOUNT_SHARED = "Thuế cần tài khoản riêng: thuế đã nộp đếm mọi khoản chi từ tài khoản này.";
/** 400 `invalid_order` của `PUT /v1/settings/goals/order`. */
export const ORDER_CHANGED = "Danh sách mục tiêu vừa đổi ở máy khác, tải lại.";

/** Tài khoản Dự phòng đang dùng chưa gắn mục tiêu đang dùng nào — chỗ chọn Ví Thưởng ở Tham số (UC-709 AC-43). */
export function rewardAccountOptions(accounts: SettingsAccount[], goals: ReserveGoal[]): SettingsAccount[] {
  return accounts.filter((a) => a.active && a.pocket === "reserve" && accountGoals(a.id, goals).length === 0);
}

/**
 * Một dòng của ô Tài khoản: `shared` = "dùng chung với {tên}, {tên}"; `blocked` = lý do không chọn được (luật Thuế);
 * `deposits` = "gồm khoản gửi kỳ hạn" khi tài khoản có con.
 */
export interface GoalAccountOption extends SettingsAccount {
  shared: string | null;
  blocked: string | null;
  deposits: string | null;
}

export const DEPOSITS_NOTE = "gồm khoản gửi kỳ hạn";

/**
 * Tài khoản cho một mục tiêu (UC-1209 bước 2, UC-709 AC-46, AC-49, AC-52): đang dùng, ngăn Dự phòng, không phải Ví Thưởng, không
 * phải tài khoản con (mục tiêu gắn mẹ — 409 `goal_on_child`); tài khoản đã có mục tiêu khác kèm "dùng chung với …". Luật Thuế
 * (QĐ1-A): mục tiêu % (`pct`) chỉ chọn được tài khoản không có mục tiêu khác; mục tiêu khác không chọn được tài khoản của mục
 * tiêu %. `goalId`: mục tiêu đang sửa (không tính là "khác").
 */
export function goalAccountOptions(accounts: SettingsAccount[], goals: ReserveGoal[], rewardAccountId: string | null | undefined, goalId: string | null, pct: boolean): GoalAccountOption[] {
  return accounts
    .filter((a) => a.active && a.pocket === "reserve" && a.id !== rewardAccountId && !a.parent_account_id)
    .map((a) => {
      const others = accountGoals(a.id, goals).filter((g) => g.id !== goalId);
      const blocked = others.length > 0 && (pct || others.some((g) => g.target_pct !== null)) ? TAX_OWN_ACCOUNT : null;
      return { ...a, shared: others.length ? `dùng chung với ${others.map((g) => g.name).join(", ")}` : null, blocked, deposits: hasChildren(a.id, accounts) ? DEPOSITS_NOTE : null };
    });
}

/**
 * Câu mềm khi chọn tài khoản đang thiếu cho một mục tiêu (UC-709 bước 4u, AC-49) — không chặn: "{tài khoản} đang thiếu {X}
 * cho {tên}, {tên}; mục tiêu này đứng thứ {k} trong tài khoản.". `k`: mục tiêu đã có giữ chỗ theo thứ tự ưu tiên hiện tại;
 * mục tiêu mới chen theo hạn (không hạn xuống cuối, QĐ5-A). Tài khoản không thiếu / đang là tài khoản của mục tiêu → null.
 */
export function goalAccountNote(d: Pick<SettingsData, "accounts" | "goals" | "goal_groups">, accountId: string, goal: { id: string | null; due_date: string | null }): string | null {
  const group = d.goal_groups.find((g) => g.account_id === accountId);
  if (!group || !group.short || (goal.id !== null && group.goal_ids.includes(goal.id))) return null;
  const others = accountGoals(accountId, d.goals);
  const index = goal.id === null ? -1 : d.goals.findIndex((g) => g.id === goal.id);
  const due = goal.due_date || null;
  const before =
    index >= 0
      ? others.filter((o) => d.goals.indexOf(o) < index).length
      : due === null
        ? others.length
        : others.filter((o) => o.due_date !== null && o.due_date <= due).length;
  const name = d.accounts.find((a) => a.id === accountId)?.name ?? accountId;
  return `${name} đang thiếu ${formatVnd(group.short)} cho ${others.map((g) => g.name).join(", ")}; mục tiêu này đứng thứ ${before + 1} trong tài khoản.`;
}

/** Lỗi khi lưu mục tiêu: luật Thuế và Ví Thưởng về ô Tài khoản (`accountId` = tài khoản đang chọn); lỗi khác giữ câu server. */
export function goalSubmitError(err: unknown, accounts: { id: string; name: string }[], accountId: string): { field: string | null; message: string } {
  if (err instanceof ApiError && err.code === "tax_account_shared") return { field: "account_id", message: TAX_ACCOUNT_SHARED };
  if (err instanceof ApiError && err.code === "account_is_reward") {
    const name = accounts.find((a) => a.id === accountId)?.name ?? accountId;
    return { field: "account_id", message: `${name} là tài khoản Ví Thưởng: chọn tài khoản Dự phòng khác cho mục tiêu.` };
  }
  return { field: null, message: errorText(err) };
}

/** Phần "đã có A / B" của một mục tiêu kèm "đã chi X tháng này" và "đủ" (A + đã chi ≥ B) — chung cho dòng danh sách và xem trước. */
function heldText(held: number, need: number | null, spent: number, where: string | null): string {
  const parts = [`đã có ${moneyDigits(held)}${need !== null ? ` / ${moneyDigits(need)}` : ""}`];
  if (where !== null) parts.push(`trong ${where}`);
  if (spent > 0) parts.push(`đã chi ${moneyDigits(spent)} tháng này`);
  if (need !== null && held + spent >= need) parts.push("đủ");
  return parts.join(" · ");
}

/**
 * Một hàng ở Cài đặt › Ba ngăn › Mục tiêu Dự phòng (UC-709 AC-36; DESIGN §4.5 tối đa một dòng phụ): tên nổi bật; bên phải đã có
 * (quá B hiện bằng B — phần dư chỉ ở dòng nhóm); chip "Đủ" / "Thiếu X" theo đã có + đã chi; thanh tiến độ (đã có + đã chi) / B;
 * dòng phụ ngắn "10% thu chịu thuế" / "hạn …" (chip đã nói phần thiếu nên không lặp "cần B" — 390px vẫn một dòng). Đã chi, số
 * mỗi tháng, mấy tháng một lần, tài khoản chỉ ở sheet mục tiêu. Chưa gắn tài khoản → không số, không chip, `needsAccount`,
 * dòng phụ "cần B · hạn …".
 */
export interface GoalRowView {
  name: string;
  amount: string | null;
  chip: { text: string; tone: "ok" | "warn" } | null;
  pct: number | null;
  sub: string | null;
  needsAccount: boolean;
}

export function goalRowView(g: ReserveGoal): GoalRowView {
  const sub: string[] = [];
  let amount: string | null = null;
  let chip: GoalRowView["chip"] = null;
  let pct: number | null = null;
  const need = g.target_pct !== null ? null : g.target_amount;
  if (!g.account_id) {
    if (need !== null) sub.push(`cần ${moneyDigits(need)}`);
  } else if (need === null) amount = formatVnd(g.held ?? 0);
  else {
    const held = g.held ?? 0;
    const covered = held + g.spent;
    amount = formatVnd(Math.min(held, need));
    pct = need > 0 ? Math.min(100, (Math.max(0, covered) / need) * 100) : 100;
    chip = covered >= need ? { text: "Đủ", tone: "ok" } : { text: `Thiếu ${moneyDigits(need - covered)}`, tone: "warn" };
  }
  if (g.target_pct !== null) sub.push(`${g.target_pct}% thu chịu thuế`);
  if (g.due_date) sub.push(`hạn ${dueText(g.due_date)}`);
  return { name: g.name, amount, chip, pct, sub: sub.length ? sub.join(" · ") : null, needsAccount: g.active && !g.account_id };
}

/**
 * Một nhóm của danh sách mục tiêu (UC-709 bước 4u): `head` = đầu nhóm tài khoản chung (tên, số dư gộp, một dòng phụ "{n} mục
 * tiêu · thiếu X / đủ / dư X"), null = mục tiêu một mình / chưa có tài khoản / đã ngừng dùng; `reorder` = có nút Đổi thứ tự;
 * `note` = "Tiền lãi {I} (không tính vào mục tiêu)" dưới nhóm khi tài khoản có tiền lãi.
 */
export interface GoalListGroup {
  key: string;
  accountId: string | null;
  head: { name: string; balance: string; meta: string } | null;
  shared: boolean;
  reorder: boolean;
  note: string | null;
  goals: ReserveGoal[];
}

/** Các phần của danh sách mục tiêu (UC-709 AC-53). */
export const GOAL_SECTION_LABEL = { account: "Để dành ở tài khoản", none: "Chưa có tài khoản", operating: "Trả từ tiền chi tiêu mỗi tháng" } as const;

const paysOperating = (g: ReserveGoal) => g.pays_from === "operating";

/**
 * Phần "Để dành ở tài khoản": nhóm theo tài khoản mẹ như thẻ Dự phòng (`goal_groups`, thứ tự server, số dư gộp); mục tiêu tài
 * khoản đang dùng chưa gắn ở nhóm `+none` (phần "Chưa có tài khoản"); mục tiêu ngừng dùng ở nhóm `+off` cuối. Mục tiêu trả từ
 * tiền chi tiêu đang dùng ở `operatingGoalRows`.
 */
export function goalListGroups(d: Pick<SettingsData, "accounts" | "goals" | "goal_groups">): GoalListGroup[] {
  const byId = new Map(d.goals.map((g) => [g.id, g]));
  const out: GoalListGroup[] = d.goal_groups.map((grp) => {
    const goals = grp.goal_ids.flatMap((id) => byId.get(id) ?? []);
    const shared = goals.length > 1;
    const name = d.accounts.find((a) => a.id === grp.account_id)?.name ?? grp.account_id;
    const state = grp.short ? `thiếu ${formatVnd(grp.short)}` : grp.extra ? `dư ${formatVnd(grp.extra)}` : "đủ";
    const head = shared ? { name, balance: formatVnd(grp.balance), meta: `${goals.length} mục tiêu · ${state}` } : null;
    // Tiền lãi là câu ghi chú dưới nhóm, không chen vào dòng phụ đầu nhóm (một dòng phụ — DESIGN §4.5, K-010).
    const note = grp.interest ? `Tiền lãi ${formatVnd(grp.interest)} (không tính vào mục tiêu)` : null;
    return { key: grp.account_id, accountId: grp.account_id, head, shared, reorder: shared, note, goals };
  });
  const loose = d.goals.filter((g) => g.active && g.account_id === null && !paysOperating(g));
  if (loose.length) out.push({ key: "+none", accountId: null, head: null, shared: false, reorder: false, note: null, goals: loose });
  const off = d.goals.filter((g) => !g.active);
  if (off.length) out.push({ key: "+off", accountId: null, head: null, shared: false, reorder: false, note: null, goals: off });
  return out;
}

/**
 * Phần "Trả từ tiền chi tiêu mỗi tháng", theo thứ tự ưu tiên: tên; bên phải "còn {R_g} tháng này"; dòng phụ "{mỗi tháng}/tháng"
 * kèm "tháng này đặt X" khi tháng này có số riêng (`monthAmounts`: mã → số riêng, từ `snapshot.pockets.operating.goals`).
 * Tháng này đặt 0 (bỏ tháng này): bên phải "Tháng này: 0 ₫", dòng phụ chỉ còn "{mỗi tháng}/tháng" — không lặp "còn 0 tháng này".
 */
export function operatingGoalRows(goals: ReserveGoal[], monthAmounts: ReadonlyMap<string, number | null> = new Map()): { goal: ReserveGoal; amount: string; sub: string }[] {
  return goals
    .filter((g) => g.active && paysOperating(g))
    .map((g) => {
      const monthly = g.monthly_amount ?? 0;
      const own = monthAmounts.get(g.id) ?? null;
      const perMonth = `${moneyDigits(monthly)}/tháng`;
      if (own === 0) return { goal: g, amount: "Tháng này: 0 ₫", sub: perMonth };
      const remaining = g.remaining ?? Math.max(0, (own ?? monthly) - g.spent);
      const sub = [perMonth, ...(own !== null ? [`tháng này đặt ${moneyDigits(own)}`] : [])].join(" · ");
      return { goal: g, amount: `còn ${moneyDigits(remaining)} tháng này`, sub };
    });
}

/**
 * Xem trước số mới khi đổi thứ tự trong một tài khoản (UC-709 AC-48): luật chia chung `goalGroups` với số dư gộp của nhóm,
 * tiền lãi của nhóm (số chia = `balance − interest`, QĐ2) và `goals[].spent`.
 */
export function goalOrderPreview(d: Pick<SettingsData, "goals" | "goal_groups">, accountId: string, ids: string[]): { id: string; name: string; text: string }[] {
  const group = d.goal_groups.find((g) => g.account_id === accountId);
  const goals = ids.flatMap((id) => d.goals.find((g) => g.id === id) ?? []);
  const { filled } = goalGroups(
    [{ id: accountId, name: accountId, balance: group?.balance ?? 0, parentId: null }],
    goals.map((g) => pocketGoal(g, accountId)),
    { [accountId]: group?.interest ?? 0 },
  );
  return goals.map((g) => ({ id: g.id, name: g.name, text: heldText(filled.get(g.id)?.held ?? 0, g.need, g.spent, null) }));
}

/** Mục tiêu ở dạng đầu vào của luật chia chung (`goalGroups`); `accountId` = tài khoản đang xét (lựa chọn chưa lưu). */
export function pocketGoal(g: ReserveGoal, accountId: string | null): PocketGoalInput {
  return {
    id: g.id,
    name: g.name,
    accountId,
    target: g.target_pct !== null ? null : (g.need ?? g.target_amount),
    targetPct: g.target_pct,
    monthly: g.monthly_amount,
    repeatMonths: g.repeat_months,
    dueDate: g.due_date,
    debtId: g.debt_id,
    sort: g.sort,
    spent: g.spent,
    paysFrom: g.pays_from ?? "account",
  };
}

/** Thân `PUT /v1/settings/goals/order`: mọi mục tiêu đang dùng; các ô của tài khoản `accountId` nhận thứ tự mới, mục tiêu khác giữ chỗ. */
export function goalOrderPayload(goals: ReserveGoal[], accountId: string, ids: string[]): { ids: string[] } {
  const next = [...ids];
  return { ids: goals.filter((g) => g.active).map((g) => (g.account_id === accountId ? next.shift()! : g.id)) };
}

/** Lỗi khi lưu thứ tự: 400 `invalid_order` (máy khác vừa đổi danh sách) → câu tải lại + nút Tải lại. */
export function goalOrderError(err: unknown): { message: string; reload: boolean } {
  if (err instanceof ApiError && err.code === "invalid_order") return { message: ORDER_CHANGED, reload: true };
  return { message: errorText(err), reload: false };
}

/** Cách đặt số của mục tiêu: lặp (số mỗi tháng + mấy tháng một lần) · một lần (số cần + hạn) · % thu chịu thuế. */
export type GoalMode = "repeat" | "once" | "pct";

export const GOAL_MODE_LABEL: Record<GoalMode, string> = { repeat: "Lặp lại", once: "Một lần", pct: "% thu chịu thuế" };

export interface GoalForm {
  name: string;
  /** Tài khoản của mục tiêu; "" = Chưa có. */
  account_id: string;
  /** "Tiền để ở đâu" (ADR-141): một tài khoản để dành · trả thẳng từ tiền chi tiêu. */
  pays_from: "account" | "operating";
  mode: GoalMode;
  monthly_amount: number;
  repeat_months: string;
  target_amount: number;
  /** YYYY-MM-DD; "" = chưa đặt. */
  due_date: string;
  target_pct: string;
  /** "" = không gắn khoản nợ. */
  debt_id: string;
  active: boolean;
  /** Danh mục tự tính là đã trả (chỉ khi trả thẳng từ tiền chi tiêu, ADR-143). */
  category_ids: string[];
}

export function goalToForm(g: ReserveGoal | null): GoalForm {
  if (!g) return { name: "", account_id: "", pays_from: "account", mode: "repeat", monthly_amount: 0, repeat_months: "1", target_amount: 0, due_date: "", target_pct: "", debt_id: "", active: true, category_ids: [] };
  return {
    name: g.name,
    account_id: g.account_id ?? "",
    pays_from: g.pays_from ?? "account",
    mode: g.target_pct !== null ? "pct" : g.monthly_amount !== null && g.repeat_months !== null ? "repeat" : "once",
    monthly_amount: g.monthly_amount ?? 0,
    repeat_months: String(g.repeat_months ?? 1),
    target_amount: g.target_amount ?? 0,
    due_date: g.due_date ?? "",
    target_pct: g.target_pct === null ? "" : String(g.target_pct),
    debt_id: g.debt_id ?? "",
    active: g.active,
    category_ids: g.category_ids ?? [],
  };
}

// ── "Tiền để ở đâu" của mục tiêu (ADR-141, UC-709 AC-52) ──────────────

export const GOAL_PLACE_LABEL = "Tiền để ở đâu";
export const PLACE_LABEL = { account: "Một tài khoản để dành", operating: "Trả thẳng từ tiền chi tiêu" } as const;
export const OPERATING_MONTHLY_ONLY = "Chỉ khoản trả mỗi tháng";
export const OPERATING_HINT = "Không phải chuyển tiền. App chừa số này khỏi 'Chi khoảng …/ngày' tới khi trả.";
export const GOAL_CATEGORIES_LABEL = "Danh mục tự tính là đã trả";
export const GOAL_CATEGORIES_HINT = "Khoản chi từ tiền chi tiêu thuộc các danh mục này, không chọn khoản phải trả nào, tự tính là đã trả cho khoản này.";

/**
 * Lựa chọn "Trả thẳng từ tiền chi tiêu": mục tiêu % (Thuế) không có (Thuế cần tài khoản riêng); "một lần" hoặc số tháng ≠ 1
 * thì tắt kèm "Chỉ khoản trả mỗi tháng" (server: 400 `operating_goal_monthly`).
 */
export function operatingChoice(f: Pick<GoalForm, "mode" | "repeat_months">): { show: boolean; disabled: string | null } {
  if (f.mode === "pct") return { show: false, disabled: null };
  return { show: true, disabled: f.mode === "repeat" && parseInteger(f.repeat_months, 1, 12) === 1 ? null : OPERATING_MONTHLY_ONLY };
}

/** Nơi để tiền đang có hiệu lực: chọn "trả từ tiền chi tiêu" mà lựa chọn đang tắt thì là "một tài khoản để dành" — sheet hiện và gửi đúng số này. */
export function goalPlace(f: Pick<GoalForm, "mode" | "repeat_months" | "pays_from">): GoalForm["pays_from"] {
  const choice = operatingChoice(f);
  return f.pays_from === "operating" && choice.show && choice.disabled === null ? "operating" : "account";
}

/** Trần số tiền như server (B, số mỗi tháng). */
const MAX_TARGET = 1_000_000_000_000;

/**
 * Thân POST (existing = null) / PATCH mục tiêu, kiểm như server (UC-1209). Lặp: số mỗi tháng + số tháng, kèm B = tích
 * (server kiểm khớp); một lần: B; thuế: %; cột của cách khác về null để không sót số cũ. Tài khoản "" → null (Chưa có).
 * Trả thẳng từ tiền chi tiêu: `pays_from: "operating"`, không `account_id` (server tự bỏ tài khoản), `category_ids` khi khác danh
 * mục đang lưu; đổi về tài khoản gửi `pays_from: "account"` (server bỏ danh mục); mục tiêu tài khoản không đổi nơi để tiền thì
 * không gửi `pays_from`.
 */
export function goalPayload(f: GoalForm, existing: ReserveGoal | null): Result<Record<string, unknown>> {
  const errors: Errors = {};
  const name = f.name.trim();
  if (!name) errors.name = "Nhập tên.";
  else if (name.length > 60) errors.name = "Tên tối đa 60 ký tự.";
  if (f.due_date && !/^\d{4}-\d{2}-\d{2}$/.test(f.due_date)) errors.due_date = "Hạn là một ngày.";
  let amounts: { target_amount: number | null; monthly_amount: number | null; repeat_months: number | null; target_pct: number | null } = {
    target_amount: null,
    monthly_amount: null,
    repeat_months: null,
    target_pct: null,
  };
  if (f.mode === "repeat") {
    const months = parseInteger(f.repeat_months, 1, 12);
    if (f.monthly_amount <= 0) errors.monthly_amount = "Nhập số mỗi tháng.";
    if (months === null) errors.repeat_months = "Số tháng là số nguyên từ 1 đến 12.";
    else if (f.monthly_amount * months > MAX_TARGET) errors.monthly_amount = "Số cần tối đa 1.000.000.000.000.";
    amounts = { ...amounts, monthly_amount: f.monthly_amount, repeat_months: months, target_amount: f.monthly_amount * (months ?? 0) };
  } else if (f.mode === "once") {
    if (f.target_amount <= 0) errors.target_amount = "Nhập số cần.";
    else if (f.target_amount > MAX_TARGET) errors.target_amount = "Số cần tối đa 1.000.000.000.000.";
    amounts = { ...amounts, target_amount: f.target_amount };
  } else {
    const pct = parseInteger(f.target_pct, 1, 100);
    if (pct === null) errors.target_pct = "% là số nguyên từ 1 đến 100.";
    amounts = { ...amounts, target_pct: pct };
  }
  const place = goalPlace(f);
  const wasOperating = existing?.pays_from === "operating";
  const saved = existing?.category_ids ?? [];
  const categoriesChanged = f.category_ids.length !== saved.length || f.category_ids.some((c) => !saved.includes(c));
  return done(errors, () => ({
    name,
    ...(place === "operating" ? (wasOperating ? {} : { pays_from: "operating" }) : { ...(wasOperating ? { pays_from: "account" } : {}), account_id: f.account_id || null }),
    ...(place === "operating" && categoriesChanged ? { category_ids: f.category_ids } : {}),
    ...amounts,
    due_date: f.due_date || null,
    debt_id: f.debt_id || null,
    ...(existing ? { active: f.active } : {}),
  }));
}

/**
 * Khoản nợ ngắn hạn đang dùng, còn nợ, có số trả mỗi tháng mà chưa có mục tiêu đang dùng gắn → một dòng gợi ý mở sheet điền sẵn
 * (UC-709 AC-39): số mỗi tháng = số trả mỗi tháng, 1 tháng một lần, hạn = ngày trả kế tiếp, gắn khoản nợ, chưa có tài khoản.
 */
export function debtGoalSuggestions(debts: Debt[], goals: ReserveGoal[], today: string): { debt: Debt; text: string; prefill: GoalForm }[] {
  const taken = new Set(goals.filter((g) => g.active && g.debt_id).map((g) => g.debt_id));
  return debts
    .filter((d) => d.active && d.term === "short" && d.balance > 0 && d.monthlyPayment && !taken.has(d.id))
    .map((d) => ({
      debt: d,
      text: `Tạo mục tiêu Trả nợ ${d.name} · ${moneyDigits(d.monthlyPayment!)}/tháng`,
      prefill: { ...goalToForm(null), name: `Trả nợ ${d.name}`, monthly_amount: d.monthlyPayment!, repeat_months: "1", due_date: nextDueDate(d.dueDay, today), debt_id: d.id },
    }));
}

// ── Tham số Tài sản & tự do (access UC-507 AC-16) ──────────────────
// Lưu phần vạn (350 = 3,5%); ô gõ theo %. Chi phí tháng, năm sinh, tuổi mục tiêu để trống = theo sổ / chưa đặt.

export type FiConfig = Pick<
  SettingsConfig,
  | "fi_swr_bps"
  | "fi_inflation_bps"
  | "fi_fat_bps"
  | "fi_legacy_rate_bps"
  | "fi_high_interest_bps"
  | "fi_safety_months"
  | "fi_expense_monthly"
  | "fi_expense_must_monthly"
  | "fi_birth_year"
  | "fi_target_age_f1"
  | "fi_target_age_f2"
  | "fi_target_age_f3"
>;

export interface FiConfigForm {
  swr: string;
  inflation: string;
  fat: string;
  legacy: string;
  highInterest: string;
  safetyMonths: string;
  expense: number;
  expenseMust: number;
  birthYear: string;
  f1: string;
  f2: string;
  f3: string;
}

const pctOfBps = (bps: number): string => String(bps / 100).replace(".", ",");
const intText = (n: number | null): string => (n === null ? "" : String(n));

export const fiConfigToForm = (c: FiConfig): FiConfigForm => ({
  swr: pctOfBps(c.fi_swr_bps),
  inflation: pctOfBps(c.fi_inflation_bps),
  fat: pctOfBps(c.fi_fat_bps),
  legacy: pctOfBps(c.fi_legacy_rate_bps),
  highInterest: pctOfBps(c.fi_high_interest_bps),
  safetyMonths: c.fi_safety_months.replace(/,/g, ", "),
  expense: c.fi_expense_monthly ?? 0,
  expenseMust: c.fi_expense_must_monthly ?? 0,
  birthYear: intText(c.fi_birth_year),
  f1: intText(c.fi_target_age_f1),
  f2: intText(c.fi_target_age_f2),
  f3: intText(c.fi_target_age_f3),
});

/** "12,5" / "12.5" / "30%" → 12.5; không đọc được → null. */
function parsePercent(text: string): number | null {
  const t = text.trim().replace("%", "").replace(",", ".").trim();
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  return Number(t);
}

/** Thân PUT /v1/settings/config cho nhóm Tài sản & tự do; khoảng hợp lệ như server (access UC-507). `year`: năm nay. */
export function fiConfigPayload(f: FiConfigForm, year: number): Result<FiConfig> {
  const errors: Errors = {};
  const bps = (key: string, text: string, min: number, max: number, label: string): number => {
    const p = parsePercent(text);
    const v = p === null ? null : Math.round(p * 100);
    if (v === null || v < min || v > max) errors[key] = `${label} từ ${pctOfBps(min)}% đến ${pctOfBps(max)}%.`;
    return v ?? 0;
  };
  const swr = bps("swr", f.swr, 100, 1000, "Tỉ lệ rút an toàn");
  const inflation = bps("inflation", f.inflation, 0, 2000, "Lạm phát");
  const fat = bps("fat", f.fat, 10000, 20000, "Hệ số dự phòng");
  const legacy = bps("legacy", f.legacy, 50, 1000, "Lãi thực");
  const high = bps("highInterest", f.highInterest, 100, 10000, "Ngưỡng lãi cao");
  const months = f.safetyMonths.split(/[,\s]+/).filter(Boolean).map((s) => parseInteger(s, 1, 60));
  if (months.length !== 3 || months.some((m, i) => m === null || (i > 0 && m <= months[i - 1]!))) errors.safetyMonths = "Ba số tháng từ 1 đến 60, tăng dần (vd 6, 12, 24).";
  const opt = (key: string, text: string, min: number, max: number, message: string): number | null => {
    if (!text.trim()) return null;
    const n = parseInteger(text, min, max);
    if (n === null) errors[key] = message;
    return n;
  };
  const birth = opt("birthYear", f.birthYear, 1900, year, `Năm sinh từ 1900 đến ${year}.`);
  const age = birth === null ? null : year - birth;
  const minAge = age === null ? 1 : age + 1;
  const ageMsg = age === null ? "Tuổi mục tiêu từ 1 đến 100." : `Tuổi mục tiêu lớn hơn tuổi hiện tại (${age}), tối đa 100.`;
  const f1 = opt("f1", f.f1, minAge, 100, ageMsg);
  const f2 = opt("f2", f.f2, minAge, 100, ageMsg);
  const f3 = opt("f3", f.f3, minAge, 100, ageMsg);
  return done(errors, () => ({
    fi_swr_bps: swr,
    fi_inflation_bps: inflation,
    fi_fat_bps: fat,
    fi_legacy_rate_bps: legacy,
    fi_high_interest_bps: high,
    fi_safety_months: months.join(","),
    fi_expense_monthly: f.expense > 0 ? f.expense : null,
    fi_expense_must_monthly: f.expenseMust > 0 ? f.expenseMust : null,
    fi_birth_year: birth,
    fi_target_age_f1: f1,
    fi_target_age_f2: f2,
    fi_target_age_f3: f3,
  }));
}

/** Một dòng tóm tắt ở Cài đặt › Tham số: "SWR 3,5% · lạm phát 3,5% · lãi cao từ 15% · Mốc an tâm 6/12/24 tháng". */
export const fiConfigSummary = (c: FiConfig): string =>
  `SWR ${pctOfBps(c.fi_swr_bps)}% · lạm phát ${pctOfBps(c.fi_inflation_bps)}% · lãi cao từ ${pctOfBps(c.fi_high_interest_bps)}% · Mốc an tâm ${c.fi_safety_months.replace(/,/g, "/")} tháng`;

// ── Giờ nhắc (cả nhà) ─────────────────────────────────────────────

export const WEEKDAY_LABEL: Record<number, string> = { 1: "Thứ Hai", 2: "Thứ Ba", 3: "Thứ Tư", 4: "Thứ Năm", 5: "Thứ Sáu", 6: "Thứ Bảy", 7: "Chủ nhật" };

/** Bắt đầu = kết thúc nghĩa là không đặt giờ yên lặng. */
export const quietLabel = (s: Pick<NotifySchedule, "quietStart" | "quietEnd">): string => (s.quietStart === s.quietEnd ? "Không đặt" : `${s.quietStart}–${s.quietEnd}`);

/** Các dòng tóm tắt ở thẻ Giờ nhắc — mỗi hàng một dòng phụ ngắn (DESIGN §4.5, K-010); chi tiết ở ghi chú thẻ và sheet. */
export function scheduleRows(s: NotifySchedule): { title: string; sub: string; value: string }[] {
  return [
    {
      title: "Tin sáng",
      sub: s.dailyEnabled ? "Chi mỗi ngày, hạn mức, việc cần làm" : "Đang tắt",
      value: s.dailyEnabled ? s.dailyTime : "Tắt",
    },
    {
      title: "Tổng kết tuần",
      sub: "Chi tuần, hạn mức, top 5 danh mục",
      value: s.weeklyEnabled ? `${WEEKDAY_LABEL[s.weeklyDay]} ${s.weeklyTime}` : "Tắt",
    },
    {
      title: "Báo giao dịch chưa gán",
      sub: s.pendingEnabled ? "Kiểm tra mỗi 15 phút" : "Đang tắt, vẫn đếm ở màn Gán",
      value: s.pendingEnabled ? "Bật" : "Tắt",
    },
    {
      title: "Giờ yên lặng",
      sub: s.quietStart === s.quietEnd ? "Báo cả ngày lẫn đêm" : "Gom lại, báo sáng ra",
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
    if (minutes === null || minutes % 15 !== 0) errors[k] = "Chọn giờ chẵn 15 phút (vd 07:00, 07:15).";
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
  /** Ngăn của tiền về (UC-506); null = theo tài khoản nhận. */
  pocket: Pocket | null;
  /** "Nguồn lương" (pocket UC-1205): lương về từ nguồn này có nhắc trích Tích luỹ. */
  is_salary: boolean;
}

export const SALARY_STREAM_HINT = "Lương về từ nguồn này có nhắc trích Tích luỹ.";

export function streamToForm(s: IncomeStream | null): StreamForm {
  if (!s) return { name: "", active: true, pocket: null, is_salary: false };
  return { name: s.name, active: s.active, pocket: s.pocket ?? null, is_salary: s.is_salary };
}

/**
 * Thân POST/PATCH nguồn thu. Nguồn cho thuê (config `rental_income_stream_id`) không bao giờ là nguồn lương: không có công tắc,
 * không gửi `is_salary` (server: 400 `cannot_be_salary`).
 */
export function streamPayload(f: StreamForm, isNew: boolean, isRental = false): Result<{ name: string; active?: boolean; pocket: Pocket | null; is_salary?: boolean }> {
  const errors: Errors = {};
  const name = f.name.trim();
  if (!name) errors.name = "Nhập tên nguồn thu.";
  return done(errors, () => ({ name, ...(isNew ? {} : { active: f.active }), pocket: f.pocket, ...(isRental ? {} : { is_salary: f.is_salary }) }));
}

/** "Nguồn lương" · "" — dòng phụ của nguồn ở Cài đặt › Nguồn thu. */
export const streamSummary = (s: IncomeStream): string => (s.is_salary ? "Nguồn lương" : "");

// ── Nhật ký thay đổi ──────────────────────────────────────────────

/** Nhãn của mọi mã nhật ký server ghi (`AUDIT_ACTIONS`), kèm mã cũ còn trong nhật ký trước v2 (chia khoản thu, chốt tháng) và trước v2.2 (người thuê chi hộ). */
export const AUDIT_ACTION: Record<AuditAction | "income.allocate" | "month.close" | "tenant.paid_for_us", string> = {
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
  "mcp.connect": "Nối Trợ lý AI",
  "mcp.revoke": "Gỡ kết nối Trợ lý AI",
  "tx.create": "Ghi giao dịch",
  "log.assign": "Gán giao dịch ngân hàng",
  "income.allocate": "Chia khoản thu",
  "tenant.paid_for_us": "Người thuê trả hộ",
  "tenant.bill_create": "Lập bản tính",
  "tenant.bill_save": "Lưu bản tính nháp",
  "tenant.bill_issue": "Chốt & gửi bản tính",
  "tenant.bill_edit": "Sửa bản tính đã gửi",
  "tenant.bill_delete": "Xoá bản tính nháp",
  "tenant.bill_item": "Claude sửa khoản bản tính",
  "month.close": "Chốt tháng",
  "pay_cycle.open": "Mở kỳ lương",
  "month_task.done": "Đã chuyển theo nhắc trích Tích luỹ",
  "month_task.skip": "Bỏ qua nhắc trích Tích luỹ",
  "month_task.reopen": "Hoàn tác nhắc trích Tích luỹ",
  "month_task.amount": "Sửa số trích Tích luỹ",
  "month_close.split": "Chia dư cuối tháng",
  "month_close.skip": "Để dư cuối tháng lại Vận hành",
  "month_close.reopen": "Hoàn tác chia dư cuối tháng",
  "goal.month_amount": "Đặt số tháng này cho khoản phải trả",
  "tx.salary": "Đổi 'Đây là lương' của khoản thu",
  "pay_cycle.void": "Huỷ kỳ lương",
  "pay_cycle_task.done": "Xong việc ngày lương",
  "pay_cycle_task.skip": "Bỏ qua việc ngày lương",
  "pay_cycle_task.reopen": "Hoàn tác việc ngày lương",
  "pay_cycle_task.amount": "Sửa số việc ngày lương",
  "pay_cycle_task.void": "Huỷ việc ngày lương",
  "goal.create": "Thêm mục tiêu Dự phòng",
  "goal.update": "Sửa mục tiêu Dự phòng",
  "conversion.step": "Chuyển sang ba ngăn: xong một bước",
  "conversion.done": "Chuyển sang ba ngăn: xong",
  "income_stream.create": "Thêm nguồn thu",
  "income_stream.update": "Sửa nguồn thu",
  "log.ignore": "Bỏ qua giao dịch ngân hàng",
  "log.unignore": "Hoàn tác bỏ qua giao dịch ngân hàng",
  "category.create": "Thêm danh mục",
  "category.update": "Sửa danh mục",
  "category_group.create": "Thêm nhóm danh mục",
  "category_group.update": "Sửa nhóm danh mục",
  "pockets.confirm": "Xác nhận ngăn tài khoản",
  "goal.order": "Đổi thứ tự mục tiêu",
  "goal.cycle_amount": "Đặt số kỳ này cho khoản phải trả",
  "config.update": "Sửa ngưỡng và tỉ lệ",
  "member.create": "Thêm thành viên",
  "member.activate": "Bật lại thành viên",
  "member.deactivate": "Tắt thành viên",
  "member.password": "Đổi mật khẩu riêng",
  "income_plan.version": "Lưu kế hoạch thu nhập",
  "report_class.set": "Xếp loại khoản cho báo cáo",
  "report_class.clear": "Bỏ xếp loại khoản cho báo cáo",
  "balance.item.create": "Thêm mục bảng cân đối",
  "balance.item.update": "Sửa mục bảng cân đối",
  "balance.item.delete": "Xoá mục bảng cân đối",
  "balance.value.add": "Cập nhật giá trị tài sản",
  "balance.value.void": "Huỷ giá trị tài sản",
  "balance.lot.add": "Thêm lô tài sản",
  "balance.lot.targets": "Đặt mục tiêu lô tài sản",
  "balance.lot.sell": "Bán lô tài sản",
  "balance.lot.void": "Huỷ lô tài sản",
  "log.link": "Nối giao dịch ngân hàng vào khoản đã ghi",
  "setup.done": "Thiết lập lần đầu",
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
    title: `${(AUDIT_ACTION as Record<string, string>)[e.action] ?? e.action}${object}`,
    sub: `${e.memberName ?? "Không rõ ai"}${AUDIT_VIA[e.via]} · ${timeHM(iso)} ${shortDate(iso)}`,
    fields: fields.length ? `đổi: ${fields.join(", ")}` : null,
  };
}

/** Phiên bản ở Cài đặt › Máy này › Về Ví nhà và chân thanh bên: `version` của package.json lúc build; trống (repo phát triển) → "Bản phát triển". */
export function appVersionLabel(version: string): string {
  return version ? `Phiên bản ${version}` : "Bản phát triển";
}
