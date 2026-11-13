// Thẻ "Trích Tích luỹ" và thẻ "Tháng dư" ở Hôm nay (pwa UC-702, pocket UC-1206 / UC-1207, ADR-144): chữ từng hàng việc, trạng
// thái, nút được bấm, mã QR (tài khoản đích, số còn thiếu, nội dung "TL 7K2Q T12" — `taskMemo` của domain, mã việc ingest nhận ra), thân yêu cầu
// `POST/PATCH /v1/month-tasks/:id…`, `POST /v1/month-close`. Thuần để test.
// Mọi số tiền qua `moneyDigits` / `formatVnd` (che số, UC-718); % và ngày không che.

import { lacksSavingsAccount, monthSurplus, nextMonth, paydayOf, taskMemo } from "../../../src/domain/month-tasks";
import type { TopUp } from "../../../src/domain/snapshot";
import { transferQr } from "../../../src/domain/vietqr";
import { formatVnd, moneyDigits } from "./money";
import { shortDate } from "./period";
import { amountOfPct, belowMinText, levelText, pctOfAmount } from "./savings-scale";
import type { EntryEffects, MonthClose, MonthTask, MonthView, QrTarget, Snapshot } from "./types";

export const SKIP_REASON_REQUIRED = "Nhập lý do không trích lần này.";
export const NEEDS_NETWORK = "Cần mạng";
const REASON_MAX = 500;
const AMOUNT_MAX = 1e12;

/** Số tháng của `YYYY-MM` (12 cho "2026-12"). */
export const monthNo = (key: string) => Number(key.slice(5, 7));

export type TaskRowState = "open" | "partial" | "done" | "skipped";

export interface TaskRow {
  id: number;
  state: TaskRowState;
  /** Dòng trên của ①: "Lương 20.000.000 ₫ về 10/12" (khoản bị giấu: "Lương ở tài khoản riêng tư"); việc chia dư: null. */
  head: string | null;
  /** "Trích Tích luỹ 10% · 2.000.000 ₫" / "Chia dư tháng 11: 2.400.000 ₫ vào Ví Thưởng"; xong thì có "✓ " phía trước. */
  title: string;
  /** "đã x / y", "tự nhận từ chuyển khoản d/m", "đánh dấu tay", "Bỏ qua — lý do". */
  sub: string | null;
  /** Việc → Tích luỹ mà nhà chưa có tài khoản Tích luỹ: tiêu đề nhắc mở tài khoản thật, chạm → Cài đặt › Ba ngăn. */
  noSavingsAccount: boolean;
  qr: boolean;
  /** Không có tài khoản nào có số tài khoản: "Chuyển sang {tên}". */
  qrHint: string | null;
  /** "Đã chuyển" (chỉ đánh dấu); null khi không có nút. */
  doneLabel: "Đã chuyển" | null;
  canSkip: boolean;
  /** ① bỏ qua / sửa về 0 phải có lý do (ADR-142). */
  needsReason: boolean;
  /** Hoàn tác: việc bỏ qua, hoặc xong do đánh dấu tay. */
  canUndo: boolean;
  /** Chạm số để sửa (việc còn mở). */
  canEdit: boolean;
}

export interface SavingsTaskCardView {
  /** Một hàng chính cho mỗi việc (nhắc ① theo khoản lương, việc chia dư sau khi bấm Chia), theo thứ tự server. */
  rows: TaskRow[];
  /** "Mục tiêu còn thiếu: Bảo dưỡng xe 760.000 ₫ ›" (chữ nhỏ, mở Ví › Dự phòng); null khi mọi mục tiêu đủ hoặc không còn ① mở. */
  goalHint: string | null;
  /** Mọi việc xong / bỏ qua: "✓ Đã trích 10% tháng 12" (thẻ thu gọn, server ẩn sau một ngày). */
  collapsed: string | null;
  /** Mất mạng: nút Đã chuyển / Bỏ qua / Hoàn tác / sửa số khoá, câu "Cần mạng". */
  offline: string | null;
}

/** Câu nhắc khi nhà chưa có tài khoản Tích luỹ (pocket UC-1206 AC-10). */
const NO_SAVINGS_ACCOUNT = "chưa có tài khoản Tích luỹ, mở tài khoản thật ›";

/** Khoản lương của ① khi người xem thấy được nó; khoản bị giấu (`{ hidden: true }`, access UC-504 AC-18) → null. */
const visibleSource = (t: MonthTask) => (t.source && !("hidden" in t.source) ? t.source : null);

/** Chữ chính của một việc (UC-702 AC-38): theo loại, số = số của việc. */
export function taskTitle(t: MonthTask): string {
  if (t.kind === "savings") return lacksSavingsAccount(t) ? `Trích Tích luỹ ${t.pct ?? 0}% · ${NO_SAVINGS_ACCOUNT}` : `Trích Tích luỹ ${t.pct ?? 0}% · ${formatVnd(t.amount)}`;
  const head = `Chia dư tháng ${monthNo(t.month)}: ${formatVnd(t.amount)} vào ${t.toAccountId !== null ? "Ví Thưởng" : "Tích luỹ"}`;
  return lacksSavingsAccount(t) ? `${head} · ${NO_SAVINGS_ACCOUNT}` : head;
}

function taskHead(t: MonthTask): string | null {
  if (t.kind !== "savings" || !t.source) return null;
  const source = visibleSource(t);
  return source ? `Lương ${formatVnd(source.amount)} về ${shortDate(source.at)}` : "Lương ở tài khoản riêng tư";
}

export function taskRow(t: MonthTask): TaskRow {
  const title = taskTitle(t);
  const head = taskHead(t);
  const none = { noSavingsAccount: false, qr: false, qrHint: null, doneLabel: null, canSkip: false, canEdit: false } as const;
  const needsReason = t.kind === "savings";
  if (t.status === "done") {
    return { id: t.id, state: "done", head, title: `✓ ${title}`, sub: t.auto && t.lastTxAt ? `tự nhận từ chuyển khoản ${shortDate(t.lastTxAt)}` : "đánh dấu tay", ...none, needsReason, canUndo: !t.auto };
  }
  if (t.status === "skipped") {
    return { id: t.id, state: "skipped", head, title, sub: t.reason ? `Bỏ qua: ${t.reason}` : "Bỏ qua", ...none, needsReason, canUndo: true };
  }
  const qr = t.targets.length > 0;
  return {
    id: t.id,
    state: t.linked > 0 ? "partial" : "open",
    head,
    title,
    sub: t.linked > 0 ? `đã ${moneyDigits(t.linked)} / ${formatVnd(t.amount)}` : null,
    noSavingsAccount: lacksSavingsAccount(t),
    qr,
    qrHint: !qr && t.targetName ? `Chuyển sang ${t.targetName}` : null,
    doneLabel: "Đã chuyển",
    canSkip: true,
    needsReason,
    canUndo: false,
    canEdit: true,
  };
}

/**
 * Dòng thu gọn khi mọi việc xong / bỏ qua: số đã trích và % trên lương cả nhà tháng này (`month.savings`: Σ phần đã ghép
 * của mọi ① ÷ Σ khoản lương — chủ nhà 12/11), vd "✓ Đã trích 3.418.000 ₫ · 10% lương cả nhà tháng 11"; không có ① thì theo việc
 * chia dư.
 */
function collapsedLine(m: MonthView): string {
  const savings = m.tasks.filter((t) => t.kind === "savings");
  if (savings.length === 0) return `Đã chia dư tháng ${monthNo(m.tasks[m.tasks.length - 1]!.month)}`;
  const month = monthNo(savings[savings.length - 1]!.month);
  if (!savings.some((t) => t.status === "done")) return `Đã bỏ qua trích Tích luỹ tháng ${month}`;
  return `Đã trích ${formatVnd(m.savings.amount)} · ${m.savings.pct ?? 0}% lương cả nhà tháng ${month}`;
}

/** Gợi ý mục tiêu dưới nhắc ① (pocket UC-1206 AC-18): một dòng, không phải việc; chỉ khi còn ① đang mở. */
export function goalHintLine(m: Pick<MonthView, "tasks" | "goalHint">): string | null {
  if (!m.goalHint || !m.tasks.some((t) => t.kind === "savings" && t.status === "open")) return null;
  return `Mục tiêu còn thiếu: ${m.goalHint.name} ${formatVnd(m.goalHint.short)} ›`;
}

/** Thẻ Trích Tích luỹ (UC-702 AC-38): null khi không có việc nào (không có thẻ). */
export function savingsTaskCard(m: MonthView | null | undefined, online: boolean): SavingsTaskCardView | null {
  if (!m || m.tasks.length === 0) return null;
  const done = m.openCount === 0;
  return {
    rows: m.tasks.map(taskRow),
    goalHint: done ? null : goalHintLine(m),
    collapsed: done ? collapsedLine(m) : null,
    offline: online ? null : NEEDS_NETWORK,
  };
}

/**
 * Dòng "Tháng 12 đã trích …" ở thẻ Tích luỹ (UC-702 AC-40, ADR-142): Tích luỹ của tháng hiện tại (`month.savings`) — số đã trích
 * (chuyển khoản thật), % trên lương của tháng, mức đạt; mọi ① bỏ qua / về 0 → "0% — {lý do}"; chưa chuyển đồng nào →
 * "Tháng 12 chưa trích (10% = …)". Tháng chưa có khoản lương sinh ① → null.
 */
export function savingsDoneLine(m: Pick<MonthView, "key" | "tasks" | "savings"> | null | undefined, savingsPct: number): string | null {
  if (!m || m.savings.base <= 0) return null;
  const { amount, level, pct } = m.savings;
  const head = `Tháng ${monthNo(m.key)}`;
  const savings = m.tasks.filter((t) => t.kind === "savings" && t.month === m.key);
  if (level === "zero") {
    const reason = savings.find((t) => (t.status === "skipped" || t.amount === 0) && t.reason)?.reason ?? null;
    return `${head} đã trích ${formatVnd(0)} · ${levelText(level, reason)}`;
  }
  if (amount <= 0) {
    const need = savings.filter((t) => t.status === "open").reduce((s, t) => s + t.amount, 0);
    return need > 0 ? `${head} chưa trích (${savingsPct}% = ${formatVnd(need)})` : `${head} chưa trích`;
  }
  const reached = levelText(level)?.replace(/^đạt /, "");
  return `${head} đã trích ${formatVnd(amount)} · ${pct ?? 0}% lương${reached ? ` · ${reached}` : ""}`;
}

/** Mức "dưới 1%": dòng "Tháng … đã trích" tô vàng (UC-702 AC-40). */
export const savingsDoneWarn = (m: Pick<MonthView, "savings"> | null | undefined): boolean => m?.savings.level === "below1";

// ── Sheet "Trích Tích luỹ" (UC-702 AC-35, ADR-142) ─────────────────

/** Trạng thái sheet: `income` = khoản lương của ① (null khi bị giấu — thanh khoá), `pct` 0 = số 0 (không vạch nào sáng), `amount` null = số gõ chưa hợp lệ. */
export interface SavingsSheet {
  income: number | null;
  pct: number;
  amount: number | null;
  reason: string;
}

export function savingsSheetOpen(t: MonthTask): SavingsSheet {
  const income = visibleSource(t)?.amount ?? null;
  const pct = t.amount === 0 && income !== null ? 0 : t.pct !== null && t.pct > 0 ? t.pct : income ? pctOfAmount(t.amount, income) : 1;
  return { income, pct, amount: t.amount, reason: "" };
}

/** Kéo thanh (hay chạm vạch): số = lương × % ÷ 100 làm tròn lên 1.000. Không biết lương → không đổi. */
export function savingsSheetDrag(s: SavingsSheet, pct: number): SavingsSheet {
  return s.income === null ? s : { ...s, pct, amount: amountOfPct(s.income, pct) };
}

/** Gõ số: thanh nhảy tới ⌊số × 100 ÷ lương⌋ (kẹp 1…100); số 0 → 0% (con trượt ở đầu, không vạch sáng); chưa hợp lệ / không biết lương giữ thanh. */
export function savingsSheetType(s: SavingsSheet, amount: number | null): SavingsSheet {
  if (s.income === null || amount === null) return { ...s, amount };
  return { ...s, amount, pct: amount === 0 ? 0 : pctOfAmount(amount, s.income) };
}

/** `pctText`: nhãn trên thanh — "{%} khoản lương"; số 0 → "0% khoản lương" (cả khi không biết lương). */
export function savingsSheetView(s: SavingsSheet): { pctText: string; warn: string | null; needsReason: boolean; problem: string | null; canSave: boolean } {
  const problem = amountProblem({ kind: "savings" }, s.amount, s.reason);
  return {
    pctText: `${s.amount === 0 ? 0 : s.pct}% khoản lương`,
    warn: s.income !== null && s.amount !== null ? belowMinText(s.amount, s.income) : null,
    needsReason: s.amount === 0,
    problem,
    canSave: problem === null,
  };
}

/** Lưu: `PATCH { amount, reason? }` — lý do chỉ gửi khi số 0. */
export function savingsSheetAction(s: SavingsSheet): TaskAction {
  return { kind: "amount", amount: s.amount ?? 0, reason: s.amount === 0 ? s.reason : "" };
}

// ── Mã QR (UC-1206 bước 10, ADR-116) ───────────────────────────────

export type TaskQr =
  | { target: QrTarget; targets: QrTarget[]; amount: number; memo: string; payload: string; label: string }
  | { target: QrTarget; targets: QrTarget[]; amount: number; memo: string; reason: string | null }
  | { hint: string | null };

function qrFor(targets: QrTarget[], targetName: string | null, amount: number, memo: string, accountId?: string): TaskQr {
  const target = targets.find((x) => x.accountId === accountId) ?? targets[0];
  if (!target) return { hint: targetName ? `Chuyển sang ${targetName}` : null };
  const qr = transferQr({
    amount,
    memo,
    to_name: target.name,
    to_kind: "bank",
    to_bank: target.bank,
    to_account_no: target.accountNo,
    to_sub_account: target.subAccount,
    to_sepay_enabled: target.subAccount !== null,
  });
  return { target, targets, amount, memo, ...qr };
}

/** Mã QR của một việc: tài khoản đích (mặc định cái đầu theo thứ tự tài khoản), số = phần còn thiếu lúc mở QR. */
export function taskQr(t: MonthTask, accountId?: string): TaskQr {
  return qrFor(t.targets, t.targetName, t.missing, taskMemo(t), accountId);
}

/** QR nhắc chuyển thêm (UC-702 AC-33, ADR-116): tới đích của `topUp`, số = phần của nguồn đó, "Bu chi tieu {d-m}" của hôm nay. */
export function topUpQr(t: TopUp, sourceAccountId: string, today: string): TaskQr {
  const amount = t.sources.find((x) => x.accountId === sourceAccountId)?.amount ?? 0;
  if (!t.target) return { hint: "Chuyển vào tiền chi tiêu" };
  return qrFor([t.target], t.target.name, amount, `Bu chi tieu ${Number(today.slice(8, 10))}-${Number(today.slice(5, 7))}`);
}

// ── Kiểm và thân yêu cầu ───────────────────────────────────────────

/** Lỗi của lý do bỏ qua: ① bắt buộc 1–500 ký tự; việc chia dư tuỳ chọn (≤ 500). */
export function skipProblem(t: Pick<MonthTask, "kind">, reason: string): string | null {
  const r = reason.trim();
  if (t.kind === "savings" && r === "") return SKIP_REASON_REQUIRED;
  if (r.length > REASON_MAX) return "Lý do tối đa 500 ký tự.";
  return null;
}

/** Lỗi của số mới: nguyên, 0..1e12; ① về 0 cần lý do. */
export function amountProblem(t: Pick<MonthTask, "kind">, amount: number | null, reason: string): string | null {
  if (amount === null || !Number.isInteger(amount) || amount < 0 || amount > AMOUNT_MAX) return "Số tiền không hợp lệ.";
  if (amount === 0) return skipProblem(t, reason);
  return reason.trim().length > REASON_MAX ? "Lý do tối đa 500 ký tự." : null;
}

export type TaskAction =
  | { kind: "done" }
  | { kind: "skip"; reason: string }
  | { kind: "reopen" }
  | { kind: "amount"; amount: number; reason: string };

/** Đường và thân yêu cầu của một thao tác; server trả `month` mới (không `goalHint`). */
export function taskRequest(id: number, a: TaskAction): { method: "POST" | "PATCH"; path: string; body: Record<string, unknown> } {
  const base = `/v1/month-tasks/${id}`;
  switch (a.kind) {
    case "done":
      return { method: "POST", path: `${base}/done`, body: {} };
    case "skip":
      return { method: "POST", path: `${base}/skip`, body: a.reason.trim() ? { reason: a.reason.trim() } : {} };
    case "reopen":
      return { method: "POST", path: `${base}/reopen`, body: {} };
    case "amount":
      return { method: "PATCH", path: base, body: a.reason.trim() ? { amount: a.amount, reason: a.reason.trim() } : { amount: a.amount } };
  }
}

/** Snapshot sau khi server trả việc tháng mới: thay `month`, giữ gợi ý mục tiêu và phần còn lại (số mỗi ngày tải lại sau). */
export const withMonth = <S extends Pick<Snapshot, "month">>(s: S, view: Omit<MonthView, "goalHint">): S => ({ ...s, month: { ...view, goalHint: s.month.goalHint } });

/** Hệ quả "nhắc trích Tích luỹ 10% = 2.000.000 ₫" của một khoản lương vừa ghi / gán (`effects.savings`). */
export const savingsReminderText = (s: NonNullable<EntryEffects["savings"]>): string => `nhắc trích Tích luỹ ${s.pct}% = ${formatVnd(s.amount)}`;

/** Toast sau một lần ghi / gán từ `effects` (UC-705 AC-39, UC-706 AC-40): "Đã ghi · nhắc trích Tích luỹ 10% = 2.000.000 ₫", "Đã ghi · Trích Tích luỹ ✓". */
export function effectsToast(effects: EntryEffects | undefined): string | null {
  if (!effects) return null;
  if (effects.savings) return `Đã ghi · ${savingsReminderText(effects.savings)}`;
  if (effects.tasksDone.length === 0) return null;
  const names = [...new Set(effects.tasksDone.map((t) => TASK_SHORT[t.kind]))];
  return `Đã ghi · ${names.join(", ")}`;
}

const TASK_SHORT: Record<MonthTask["kind"], string> = { savings: "Trích Tích luỹ", surplus: "Chia dư" };

// ── Thẻ Tháng dư (UC-702 AC-39, pocket UC-1207) ────────────────────

/** % vào Tích luỹ chọn nhanh ở chip "50 / 50". */
export const SURPLUS_PCT_CHOICES = [0, 30, 50, 70, 100] as const;

export interface MonthCloseCardView {
  /** "Tháng 11 dư 4.800.000 ₫"; S < 0: "Tháng 11 tiêu quá 1.200.000 ₫ — không có gì để chia". */
  title: string;
  /** "Vận hành cuối tháng … · giữ khoản phải trả … · giữ ăn tiêu tới 10/12 …" (+ "· đang chờ chuyển …" khi W > 0); S < 0: null. */
  detail: string | null;
  /** Chip "50 / 50" (Tích luỹ / Ví Thưởng) — chạm để đổi %; S < 0: null. */
  chip: string | null;
  /** "2.400.000 Tích luỹ · 2.400.000 Ví Thưởng"; chưa chọn Ví Thưởng: "… · 2.400.000 để lại Vận hành". */
  split: string | null;
  /** Nút Chia và Để lại Vận hành (S > 0). */
  canSplit: boolean;
  /** % đang chọn (gửi kèm `savings_pct`). */
  pct: number;
}

/**
 * Thẻ Tháng dư: chỉ khi `monthClose.status` = `ask` và S ≠ 0. `pct` = % người chọn trên chip (mặc định % của server); số chia tính
 * lại bằng đúng phép của server (`monthSurplus`). `hasReward` = đã chọn Ví Thưởng (`pockets.reserve.reward`).
 */
export function monthCloseCard(mc: MonthClose | null | undefined, opts: { pct?: number; paydayDay: number; hasReward: boolean }): MonthCloseCardView | null {
  if (!mc || mc.status !== "ask" || mc.surplus === 0) return null;
  const month = `Tháng ${monthNo(mc.month)}`;
  const pct = opts.pct ?? mc.pct;
  if (mc.surplus < 0) return { title: `${month} tiêu quá ${formatVnd(-mc.surplus)}, không còn để chia`, detail: null, chip: null, split: null, canSplit: false, pct };
  const payday = shortDate(paydayOf(nextMonth(mc.month), opts.paydayDay));
  const detail = [
    `Vận hành cuối tháng ${moneyDigits(mc.operatingEnd)}`,
    ...(mc.pendingAtEnd > 0 ? [`đang chờ chuyển ${moneyDigits(mc.pendingAtEnd)}`] : []),
    ...(mc.earlySalary > 0 ? [`lương tháng ${monthNo(nextMonth(mc.month))} về sớm ${moneyDigits(mc.earlySalary)}`] : []),
    `giữ khoản phải trả ${moneyDigits(mc.heldPayables)}`,
    ...(mc.heldToPayday > 0 ? [`giữ ăn tiêu tới ${payday} ${moneyDigits(mc.heldToPayday)}`] : []),
  ].join(" · ");
  const { savingsAmount, rewardAmount } = monthSurplus({ E: mc.surplus, W: 0, L: 0, P: 0, D: 0, pct, rewardAccount: opts.hasReward ? "reward" : null });
  const rest = opts.hasReward ? `${moneyDigits(rewardAmount)} Ví Thưởng` : `${moneyDigits(mc.surplus - savingsAmount)} để lại Vận hành`;
  return {
    title: `${month} dư ${formatVnd(mc.surplus)}`,
    detail,
    chip: `${pct} / ${100 - pct}`,
    split: `${moneyDigits(savingsAmount)} Tích luỹ · ${rest}`,
    canSplit: true,
    pct,
  };
}

/** Chia: `POST /v1/month-close { month, savings_pct }` (201 `{ monthClose }`; hai máy bấm đua → 409 `month_closed`). */
export const monthSplitRequest = (mc: Pick<MonthClose, "month">, pct: number) => ({ path: "/v1/month-close", body: { month: mc.month, savings_pct: pct } });

/** Để lại Vận hành: `POST /v1/month-close/:month/skip` (không cần lý do). */
export const monthSkipPath = (mc: Pick<MonthClose, "month">) => `/v1/month-close/${mc.month}/skip`;

/** Mở lại chia dư: `POST /v1/month-close/:month/reopen` (pocket UC-1207 AC-7). */
export const monthReopenPath = (mc: Pick<MonthClose, "month">) => `/v1/month-close/${mc.month}/reopen`;
