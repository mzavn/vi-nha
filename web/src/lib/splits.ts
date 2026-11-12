// Tách một log ngân hàng thành nhiều dòng: tổng các dòng phải bằng đúng số tiền log (phase 04, lớp 2).
// Hình dạng `Split` khớp src/services/ingest.ts — không import trực tiếp vì file đó kéo theo kiểu D1. Không ví (Đợt C).

import { goalField, type GoalRow } from "./goal-choices";
import { formatVnd } from "./money";
import { effectsToast } from "./pay-cycle";
import { entryToast } from "./pending";
import { shortDate, timeHM } from "./period";
import { MEANING_LABEL } from "./transactions";
import type { AccountRef, BankLog, EntryEffects, EntryNearSpend, ManualMatch } from "./types";

export type SplitMeaning = "spend" | "transfer" | "income" | "refund" | "lend" | "collect" | "buy_asset";

export interface Split {
  meaning: SplitMeaning;
  amount: number;
  category_id?: string | null;
  other_account_id?: string | null;
  taxable?: boolean;
  asset_kind?: string | null;
  note?: string | null;
  /** income: nguồn thu và người thuê trả tiền. */
  income_stream_id?: string | null;
  tenant_id?: string | null;
  /** income: "Lương — mở kỳ lương" (pocket UC-1205); mặc định theo cờ của nguồn. */
  opens_cycle?: boolean;
  /** spend: khoản chi này trả cho khoản nợ nào trong sổ nợ. */
  debt_id?: string | null;
  /** spend: khoản chi trả lãi cho khoản nợ nào (danh mục "Lãi vay"); không đi cùng `debt_id`. */
  interest_debt_id?: string | null;
  /** lend / collect: cho vay hay nhận lại tiền gắn vào khoản nào trong sổ phải thu. */
  receivable_id?: string | null;
  /** refund / collect: khoản gốc được trả (ô "Trả lại cho khoản chi" / "Trả cho khoản cho vay"). */
  link_id?: number | null;
  /** income: lãi tiền gửi (change 261018-lai-tien-gui) — một dòng trọn số tiền log. */
  interest?: boolean;
  /** spend / transfer của log tiền ra: mục tiêu Dự phòng của tài khoản (chip "Cho mục tiêu", pocket UC-1209 bước 11). */
  goal_id?: string | null;
  /** income vào mẹ có mục tiêu / con của nó: ô "Đây là tiền lãi" (QĐ2) — server ghi phân loại `passive_income`. */
  is_interest?: boolean;
  /** spend / transfer ra khỏi nhóm mẹ + con: chip "Từ tiền lãi" (QĐ2); không đi cùng `goal_id`. */
  from_interest?: boolean;
}

/** Một dòng trên form Gán: `tenantMode` / `interestMode` là lựa chọn trên màn hình, gửi lên thành income kèm tenant_id / interest. */
export type AssignRow = Split & { key: number; tenantMode?: boolean; interestMode?: boolean };

/** "tenant" và "interest" chỉ là lựa chọn trên màn hình: gửi lên thành income kèm tenant_id / interest. */
export type AssignChoice = SplitMeaning | "tenant" | "interest";

/**
 * Hàng chip "Gán thành" theo chiều tiền (UC-706), mỗi loại kèm đúng một dòng giải thích hiện dưới hàng chip.
 * Bảng đầy đủ, ví dụ trả hơn / kém: hướng dẫn `ngan-hang/tien-vao-chon-loai` (GUIDE_PICK_KIND_URL).
 */
export const ASSIGN_CHOICES: Record<"in" | "out", { value: AssignChoice; label: string; hint: string }[]> = {
  in: [
    { value: "income", label: "Thu nhập", hint: "Tiền mới của nhà (lương, thưởng, lãi, quà). Lương mở kỳ lương và danh sách việc ngày lương." },
    { value: "interest", label: "Lãi tiền gửi", hint: "Lãi ngân hàng trả — ghi vào tài khoản nhận, báo cáo xếp Thu nhập thụ động, không mở kỳ lương." },
    { value: "tenant", label: "Thu từ người thuê", hint: "Người thuê trả tiền — trừ vào số họ còn nợ, ghi theo nguồn cho thuê." },
    {
      value: "refund",
      label: "Hoàn tiền",
      hint: "Khoản nhà mình chi rồi được trả lại một phần (góp tiền bill, shop hoàn) — chọn khoản chi đó; danh mục còn đúng phần nhà mình.",
    },
    {
      value: "collect",
      label: "Nhận lại tiền cho vay",
      hint: "Người ta trả khoản đã ghi Cho vay (cả mua hộ) — chọn đúng lần cho vay. Trả dư thì Tách thêm dòng Thu nhập cho phần dư.",
    },
    { value: "transfer", label: "Chuyển nội bộ", hint: "Tiền của chính nhà mình chuyển qua lại — không phải thu nhập." },
  ],
  out: [
    { value: "spend", label: "Chi tiêu", hint: "Nhà mình tiêu tiền theo danh mục. Trả cả bill mà nhà mình có phần: ghi đủ ở đây, phần người khác chuyển lại ghi Hoàn tiền." },
    { value: "transfer", label: "Chuyển nội bộ", hint: "Tiền của chính nhà mình chuyển qua lại (sang tài khoản khác, rút tiền mặt) — không phải chi." },
    {
      value: "lend",
      label: "Cho vay",
      hint: "Cho mượn tiền, hay mua hộ / trả hộ người khác (nhà mình không có phần) — người ta sẽ trả lại. Ghi vào sổ phải thu, không phải chi tiêu.",
    },
    { value: "buy_asset", label: "Mua tài sản", hint: "Mua vàng, cổ phiếu, chứng chỉ quỹ, nhà đất — tiền thành tài sản, không phải chi tiêu." },
  ],
};

/** Hướng dẫn sử dụng (GitBook) — thanh bên máy tính và Cài đặt › Máy này dẫn tới. */
export const GUIDE_URL = "https://mzavn.gitbook.io/vi-nha";
/** Đăng ký SePay qua link giới thiệu của Ví nhà — Cài đặt › Kết nối › SePay. */
export const SEPAY_REGISTER_URL = "https://my.sepay.vn/register?gcid=arqcwdek";
/** Mã nguồn Ví nhà (AGPL-3.0) — Cài đặt › Máy này › Về Ví nhà (điện thoại) và chân thanh bên (máy tính). */
export const SOURCE_URL = "https://github.com/mzavn/vi-nha";

/** Trang hướng dẫn "Tiền vào: chọn loại nào?" — banner "Tiền vào luôn phải hỏi" ở màn Gán dẫn tới. */
export const GUIDE_PICK_KIND_URL = `${GUIDE_URL}/ngan-hang/tien-vao-chon-loai`;

export interface SplitCheck {
  ok: boolean;
  sum: number;
  /** total − sum: dương là còn thiếu, âm là thừa. */
  diff: number;
  message: string | null;
}

export function validateSplits(total: number, splits: Split[]): SplitCheck {
  const sum = splits.reduce((s, x) => s + (Number.isInteger(x.amount) ? x.amount : 0), 0);
  const diff = total - sum;
  const fail = (message: string): SplitCheck => ({ ok: false, sum, diff, message });

  if (splits.length === 0) return fail("Cần ít nhất một dòng.");
  const idx = splits.findIndex((s) => !Number.isInteger(s.amount) || s.amount <= 0);
  if (idx >= 0) return fail(`Dòng ${idx + 1} chưa có số tiền.`);
  const noCat = splits.findIndex((s) => s.meaning === "spend" && !s.category_id);
  if (noCat >= 0) return fail(`Dòng ${noCat + 1} là khoản chi, cần danh mục.`);
  const noAcct = splits.findIndex((s) => s.meaning === "transfer" && !s.other_account_id);
  if (noAcct >= 0) return fail(`Dòng ${noAcct + 1} là chuyển nội bộ, cần tài khoản đầu kia.`);
  const noKind = splits.findIndex((s) => s.meaning === "buy_asset" && !s.asset_kind);
  if (noKind >= 0) return fail(`Dòng ${noKind + 1} là mua tài sản, cần loại tài sản.`);
  if (diff > 0) return fail(`Còn thiếu ${formatVnd(diff)} so với log.`);
  if (diff < 0) return fail(`Thừa ${formatVnd(-diff)} so với log.`);
  return { ok: true, sum, diff, message: null };
}

/**
 * Thân POST /v1/logs/:id/assign (UC-305, UC-706): mỗi dòng chỉ mang trường đúng loại — không trường ví, không
 * `transfer_order_id`, không `earmark_id`. Thu nhập mang `opens_cycle` (trừ tiền người thuê và lãi), `is_interest` khi ô
 * "Đây là tiền lãi" có (`interest`) và được bật. Chi / chuyển ra mang `goal_id` / `from_interest` theo hàng "Cho mục tiêu"
 * của tài khoản log tiền ra (`goals(tài khoản nhận)` — UC-706 AC-39, QĐ2).
 */
export function assignBody(
  rows: AssignRow[],
  createRule: boolean,
  o: { goals?: (toAccountId: string | null) => GoalRow | null; interest?: boolean } = {},
): { splits: Split[]; create_rule: boolean } {
  const interest = rows.find((r) => r.interestMode);
  if (interest) return { splits: [{ meaning: "income", amount: interest.amount, interest: true, ...(interest.note ? { note: interest.note } : {}) }], create_rule: createRule };
  const splits = rows.map(
    ({ key: _k, tenantMode, interestMode: _i, tenant_id, income_stream_id, opens_cycle, debt_id, interest_debt_id, receivable_id, link_id, other_account_id, category_id, taxable, asset_kind, goal_id, is_interest, from_interest: _f, ...s }): Split => ({
      ...s,
      ...(s.meaning === "spend" || s.meaning === "refund" ? { category_id: category_id ?? null } : {}),
      ...(s.meaning === "transfer" ? { other_account_id } : {}),
      ...(s.meaning === "income" ? { taxable: taxable === true } : {}),
      ...(s.meaning === "buy_asset" ? { asset_kind } : {}),
      ...(s.meaning === "income" && tenant_id ? { tenant_id } : {}),
      ...(s.meaning === "income" && income_stream_id ? { income_stream_id } : {}),
      ...(s.meaning === "income" && !tenantMode && opens_cycle !== undefined ? { opens_cycle } : {}),
      ...(s.meaning === "income" && !tenantMode && o.interest && is_interest ? { is_interest: true } : {}),
      ...(s.meaning === "spend" && debt_id ? { debt_id } : {}),
      ...(s.meaning === "spend" && interest_debt_id ? { interest_debt_id } : {}),
      ...((s.meaning === "lend" || s.meaning === "collect") && receivable_id ? { receivable_id } : {}),
      ...((s.meaning === "refund" || s.meaning === "collect") && link_id ? { link_id } : {}),
      ...(s.meaning === "spend" || s.meaning === "transfer" ? goalField(goal_id, o.goals?.(s.meaning === "transfer" ? (other_account_id ?? null) : null)) : {}),
    }),
  );
  return { splits, create_rule: createRule };
}

/**
 * Toast sau khi gán một log (UC-706 bước 10, DESIGN §4): kết quả kèm hệ quả theo kỳ lương / việc (`effects`) hoặc theo
 * Vận hành (`nearSpend` sau khi tải lại). `label`: tên danh mục (không có thì tên loại) của dòng duy nhất.
 */
export function assignToast(splits: Split[], o: { label: string; effects?: EntryEffects; nearSpend: EntryNearSpend | null }): string {
  const fx = effectsToast(o.effects);
  const income = splits.find((s) => s.meaning === "income");
  if (o.effects?.cycle?.opened && income) return `Đã gán ${formatVnd(income.amount)} · ${fx}`;
  if (fx) return fx;
  if (income) return `Đã gán thu nhập ${formatVnd(income.amount)}.`;
  if (splits.length > 1) return `Đã gán ${splits.length} dòng.`;
  const s = splits[0]!;
  if (s.meaning === "transfer") return `Đã gán chuyển nội bộ ${formatVnd(s.amount)}.`;
  if (s.meaning === "spend" && o.nearSpend) return entryToast(o.nearSpend, false).replace("Đã ghi", `Đã gán ${formatVnd(s.amount)} ${o.label}`);
  return `Đã gán ${formatVnd(s.amount)} ${o.label}.`;
}

/** Toast sau khi gán Lãi tiền gửi (UC-706): không mở kỳ, không việc. */
export function interestToast(amount: number): string {
  return `Đã ghi lãi ${formatVnd(amount)}`;
}

/** Dòng thay log chờ của tài khoản riêng tư bị giấu (UC-706 AC-36): "1 khoản của tài khoản riêng tư". */
export function hiddenLogsLine(count: number | undefined): string | null {
  return count ? `${count} khoản của tài khoản riêng tư` : null;
}

/**
 * Ô tài khoản đầu kia khi gán chuyển khoản (UC-706 AC-37): mọi tài khoản trừ tài khoản của log và tài khoản riêng tư của
 * người khác (`hiddenFromMe`) — server từ chối chuyển vào đó (access UC-504 AC-17).
 */
export function counterpartAccounts(accounts: AccountRef[], logAccountId: string | null): AccountRef[] {
  return accounts.filter((a) => a.id !== logAccountId && !a.hiddenFromMe);
}

/**
 * Chip của một log ở danh sách Gán (UC-706): có thể trùng → lãi tiền gửi → khớp mẫu lương → tiền vào phải hỏi → người thuê →
 * gợi ý khác (`suggestionLabel` đọc tên danh mục / ví / loại) → chưa có luật.
 */
export function logChip(log: Pick<BankLog, "direction" | "suggestion">, suggestionLabel: () => string): { cls: string; text: string } {
  const s = log.suggestion;
  if (s?.possible_duplicate_of) return { cls: "chip warn", text: "có thể trùng — xem trước khi gán" };
  if (s?.interest) return { cls: "chip ok", text: `gợi ý: ${s.label ?? "Lãi tiền gửi"}` };
  if (s?.is_salary && !s.tenant_id) return { cls: "chip ok", text: "khớp mẫu lương" };
  if (log.direction === "in" && !s) return { cls: "chip warn", text: "tiền vào — phải hỏi" };
  if (s?.tenant_id) return { cls: "chip", text: `gợi ý: ${s.label ?? "thu từ người thuê"}` };
  if (s?.meaning) return { cls: "chip", text: `gợi ý: ${suggestionLabel()}` };
  return { cls: "chip", text: "chưa có luật" };
}

/** Một dòng "Đã nhập tay?" ở màn Gán: giờ VN, danh mục (không có thì loại giao dịch), ghi chú. */
export function manualMatchLabel(m: ManualMatch, categoryName: string | null): string {
  const what = categoryName ?? MEANING_LABEL[m.meaning] ?? m.meaning;
  return `${shortDate(m.at)} ${timeHM(m.at)} · ${what}${m.note ? ` · ${m.note}` : ""}`;
}

/** Toast sau khi Nối log vào khoản đã nhập tay. */
export const linkToast = (amount: number): string => `Đã nối ${formatVnd(amount)} vào khoản đã nhập tay — không ghi thêm.`;
