// Thẻ "Việc ngày lương" ở Hôm nay (pwa UC-702, pocket UC-1206 / UC-1207): chữ từng hàng việc, trạng thái, nút được bấm, mã QR
// (tài khoản đích, số còn thiếu, nội dung không dấu) và thân yêu cầu `POST/PATCH /v1/pay-cycle-tasks/:id…`. Thuần để test.
// Mọi số tiền qua `moneyDigits` / `formatVnd` (che số, UC-718); % và ngày không che.

import { lacksSavingsAccount } from "../../../src/domain/pay-cycle";
import type { TopUp } from "../../../src/domain/snapshot";
import { transferQr } from "../../../src/domain/vietqr";
import { formatVnd, moneyDigits } from "./money";
import { shortDate } from "./period";
import { POCKET_LABEL } from "./pockets";
import { amountOfPct, belowMinText, levelText, pctOfAmount } from "./savings-scale";
import type { PayCycleTask, PayCycleView, QrTarget, Snapshot } from "./types";

export const SKIP_REASON_REQUIRED = "Không trích kỳ này cần ghi lý do";
export const NEEDS_NETWORK = "Cần mạng";
export const NO_CYCLE_STREAM = "Chưa có nguồn nào mở kỳ lương — chọn nguồn lương ›";
const REASON_MAX = 500;
const AMOUNT_MAX = 1e12;

export type TaskRowState = "open" | "partial" | "done" | "skipped";

export interface PayTaskRow {
  id: number;
  state: TaskRowState;
  /** "Trích Tích luỹ 10% · 2.000.000 ₫"; xong thì có "✓ " phía trước. */
  title: string;
  /** Dòng phụ: nguồn, "đã có A / B trong {tài khoản}", "đã x / y", "tự nhận từ chuyển khoản d/m", "đánh dấu tay", "Bỏ qua — lý do". */
  sub: string | null;
  /** ① (④ → Tích luỹ) mà nhà chưa có tài khoản Tích luỹ: tiêu đề nhắc mở tài khoản thật, chạm → Cài đặt › Ba ngăn. */
  noSavingsAccount: boolean;
  qr: boolean;
  /** Không có tài khoản nào có số tài khoản: "Chuyển sang {tên}". */
  qrHint: string | null;
  /** "Đã chuyển" (② tài khoản của mục tiêu, ④ → Ví Thưởng: chỉ đánh dấu) hay "Đã làm"; null khi không có nút. */
  doneLabel: "Đã làm" | "Đã chuyển" | null;
  canSkip: boolean;
  /** ① bỏ qua / sửa về 0 phải có lý do (ADR-112). */
  needsReason: boolean;
  /** Hoàn tác: việc bỏ qua, hoặc xong do đánh dấu tay. */
  canUndo: boolean;
  /** Chạm số để sửa (việc còn mở). */
  canEdit: boolean;
}

export interface PayCycleCardView {
  /** "Việc ngày lương · kỳ từ 10/11". */
  title: string;
  /** "còn 5"; null khi đã xong cả. */
  chip: string | null;
  /** Mọi việc xong / bỏ qua: "Việc ngày lương: xong cả 5 việc ✓" (thẻ thu gọn). */
  collapsed: string | null;
  /** Dư kỳ trước âm: "Kỳ trước tiêu quá 300.000 ₫ — không có gì để chia". */
  overspent: string | null;
  /** Việc theo thứ tự server, trừ các việc ② đang mở cùng tài khoản đích được dời về liền nhau (UC-702 bước 6). */
  rows: PayTaskRow[];
  /** Từ hai việc ② đang mở cùng tài khoản đích: dòng gộp đứng trước việc đầu (`taskIds[0]`), QR gộp khi tài khoản có số. */
  goalGroups: GoalTaskGroup[];
  /** Mất mạng: nút Đã làm / Bỏ qua / Hoàn tác / sửa số khoá, câu "Cần mạng". */
  offline: string | null;
}

export interface GoalTaskGroup {
  accountId: string;
  /** "Chuyển {Σ thiếu} vào {tài khoản} · {n} mục tiêu". */
  title: string;
  taskIds: number[];
  qr: boolean;
}

/** Việc ② đang mở có tài khoản đích — gộp hiển thị và QR theo tài khoản (pocket UC-1206 bước 10, QĐ4-A). */
const openGoalTask = (t: PayCycleTask) => t.kind === "goal" && t.status === "open" && t.toAccountId !== null;

/** Dời các việc ② đang mở cùng tài khoản đích về ngay sau việc đầu của nhóm; trả kèm các nhóm từ hai việc. */
function groupGoalTasks(tasks: PayCycleTask[]): { ordered: PayCycleTask[]; groups: GoalTaskGroup[] } {
  const byAccount = new Map<string, PayCycleTask[]>();
  for (const t of tasks) if (openGoalTask(t)) byAccount.set(t.toAccountId!, [...(byAccount.get(t.toAccountId!) ?? []), t]);
  const ordered: PayCycleTask[] = [];
  const groups: GoalTaskGroup[] = [];
  for (const t of tasks) {
    const same = openGoalTask(t) ? byAccount.get(t.toAccountId!)! : [t];
    if (same.length < 2) {
      ordered.push(t);
      continue;
    }
    if (same[0] !== t) continue;
    ordered.push(...same);
    groups.push({
      accountId: t.toAccountId!,
      title: `Chuyển ${formatVnd(same.reduce((s, x) => s + x.missing, 0))} vào ${t.targetName ?? ""} · ${same.length} mục tiêu`,
      taskIds: same.map((x) => x.id),
      qr: t.targets.length > 0,
    });
  }
  return { ordered, groups };
}

/** Câu nhắc khi nhà chưa có tài khoản Tích luỹ (① và ④ → Tích luỹ, pocket UC-1206 AC-10). */
const NO_SAVINGS_ACCOUNT = "chưa có tài khoản Tích luỹ — mở tài khoản thật ›";

/** Khoản thu của việc khi người xem thấy được nó; khoản thu bị giấu (`{ hidden: true }`, access UC-504 AC-18) → null. */
const visibleSource = (t: PayCycleTask) => (t.source && !("hidden" in t.source) ? t.source : null);

/** Chữ chính của một việc (UC-702): theo loại, số = số của việc. */
export function taskTitle(c: Pick<PayCycleView, "prevOperating">, t: PayCycleTask): string {
  const amount = formatVnd(t.amount);
  switch (t.kind) {
    case "savings":
      return lacksSavingsAccount(t) ? `Trích Tích luỹ ${t.pct ?? 0}% · ${NO_SAVINGS_ACCOUNT}` : `Trích Tích luỹ ${t.pct ?? 0}% · ${amount}`;
    case "goal":
      return `Nạp ${t.goal?.name ?? ""} · ${amount}`;
    case "move":
      return `Chuyển ${visibleSource(t)?.streamName ?? "khoản thu"} sang ${t.toPocket ? POCKET_LABEL[t.toPocket] : ""} · ${amount}`;
    case "surplus": {
      const head = `Dư kỳ trước ${formatVnd(c.prevOperating)}: ${amount} vào ${t.toAccountId !== null ? "Ví Thưởng" : "Tích luỹ"}`;
      return lacksSavingsAccount(t) ? `${head} · ${NO_SAVINGS_ACCOUNT}` : head;
    }
  }
}

/** Dòng phụ khi việc còn mở, chưa ghép đồng nào. */
function openSub(t: PayCycleTask): string | null {
  const source = visibleSource(t);
  if (t.kind === "savings" && t.source && !source) return "từ khoản lương ở tài khoản riêng tư";
  if (t.kind === "savings" && source) return `từ lương ${formatVnd(source.amount)} ngày ${shortDate(source.at)}`;
  if (t.kind === "goal" && t.goal) {
    if (t.pct !== null && source) return `${t.pct}% khoản thu chịu thuế ${formatVnd(source.amount)}`;
    if (t.goal.held === null) return "mục tiêu chưa có tài khoản";
    const where = t.targetName ? ` trong ${t.targetName}` : "";
    return t.goal.target !== null ? `đã có ${moneyDigits(t.goal.held)} / ${formatVnd(t.goal.target)}${where}` : `đã có ${formatVnd(t.goal.held)}${where}`;
  }
  return null;
}

export function taskRow(c: Pick<PayCycleView, "prevOperating">, t: PayCycleTask): PayTaskRow {
  const title = taskTitle(c, t);
  const none = { noSavingsAccount: false, qr: false, qrHint: null, doneLabel: null, canSkip: false, canEdit: false } as const;
  const needsReason = t.kind === "savings";
  if (t.status === "done") {
    return { id: t.id, state: "done", title: `✓ ${title}`, sub: t.auto && t.lastTxAt ? `tự nhận từ chuyển khoản ${shortDate(t.lastTxAt)}` : "đánh dấu tay", ...none, needsReason, canUndo: !t.auto };
  }
  if (t.status === "skipped") {
    return { id: t.id, state: "skipped", title, sub: t.reason ? `Bỏ qua — ${t.reason}` : "Bỏ qua", ...none, needsReason, canUndo: true };
  }
  const qr = t.targets.length > 0;
  return {
    id: t.id,
    state: t.linked > 0 ? "partial" : "open",
    title,
    sub: t.linked > 0 ? `đã ${moneyDigits(t.linked)} / ${formatVnd(t.amount)}` : openSub(t),
    noSavingsAccount: lacksSavingsAccount(t),
    qr,
    qrHint: !qr && t.targetName ? `Chuyển sang ${t.targetName}` : null,
    doneLabel: t.goal !== null || t.toAccountId !== null ? "Đã chuyển" : "Đã làm",
    canSkip: true,
    needsReason,
    canUndo: false,
    canEdit: true,
  };
}

/** Thẻ việc: null khi không kỳ hoặc kỳ không có việc nào (UC-702: không có thẻ). */
export function payCycleCard(c: PayCycleView | null | undefined, online: boolean): PayCycleCardView | null {
  if (!c || c.tasks.length === 0) return null;
  const done = c.openCount === 0;
  const { ordered, groups } = groupGoalTasks(c.tasks);
  return {
    title: `Việc ngày lương · kỳ từ ${shortDate(c.startedAt)}`,
    chip: done ? null : `còn ${c.openCount}`,
    collapsed: done ? `Việc ngày lương: xong cả ${c.tasks.length} việc ✓` : null,
    overspent: c.prevOperating < 0 ? `Kỳ trước tiêu quá ${formatVnd(-c.prevOperating)} — không có gì để chia` : null,
    rows: ordered.map((t) => taskRow(c, t)),
    goalGroups: groups,
    offline: online ? null : NEEDS_NETWORK,
  };
}

/** Dòng nhắc thay thẻ việc khi chưa nguồn nào bật "Mở kỳ lương" (UC-702 AC-26). Bản lưu cũ thiếu `paySetup`: không nhắc. */
export function noCycleStreamLine(s: { paySetup?: { hasCycleStream: boolean } }): string | null {
  return s.paySetup && !s.paySetup.hasCycleStream ? NO_CYCLE_STREAM : null;
}

/**
 * "Kỳ này đã trích" ở thẻ Tích luỹ (UC-702 AC-32, AC-36): chỉ khi kỳ có khoản lương sinh ①. Số cần = Σ số các ① không bỏ qua; % là
 * `savings_pct` đã cài (không phải đã ghép ÷ lương); có mức đạt thì thêm "· đạt mức …"; mọi ① bỏ qua / về 0 → "0% — {lý do}".
 */
export function savingsDoneLine(c: PayCycleView | null | undefined, savingsPct: number): string | null {
  if (!c || c.savingsDone.base <= 0) return null;
  const { amount, level = null } = c.savingsDone;
  const savings = c.tasks.filter((t) => t.kind === "savings");
  if (level === "zero") {
    const reason = savings.find((t) => (t.status === "skipped" || t.amount === 0) && t.reason)?.reason ?? null;
    return `Kỳ này đã trích ${formatVnd(0)} · ${levelText(level, reason)}`;
  }
  const need = savings.filter((t) => t.status !== "skipped").reduce((s, t) => s + t.amount, 0);
  if (amount <= 0) return `Kỳ này chưa trích (${savingsPct}% = ${formatVnd(need)})`;
  const reached = levelText(level);
  const tail = reached ? ` · ${reached}` : "";
  if (amount >= need) return `Kỳ này đã trích ✓ ${formatVnd(amount)} (${savingsPct}%)${tail}`;
  return `Kỳ này đã trích ${moneyDigits(amount)} / ${formatVnd(need)} (${savingsPct}%)${tail}`;
}

/** Mức "dưới 1%": dòng "Kỳ này đã trích" tô vàng (UC-702 AC-36). */
export const savingsDoneWarn = (c: PayCycleView | null | undefined): boolean => c?.savingsDone.level === "below1";

// ── Sheet "Trích Tích luỹ" (UC-702 AC-35, ADR-142) ─────────────────

/** Trạng thái sheet: `income` = khoản lương của ① (null khi bị giấu — thanh khoá), `amount` null = số gõ chưa hợp lệ. */
export interface SavingsSheet {
  income: number | null;
  pct: number;
  amount: number | null;
  reason: string;
}

export function savingsSheetOpen(t: PayCycleTask): SavingsSheet {
  const income = visibleSource(t)?.amount ?? null;
  const pct = t.pct !== null && t.pct > 0 ? t.pct : income ? pctOfAmount(t.amount, income) : 1;
  return { income, pct, amount: t.amount, reason: "" };
}

/** Kéo thanh (hay chạm vạch): số = lương × % ÷ 100 làm tròn lên 1.000. Không biết lương → không đổi. */
export function savingsSheetDrag(s: SavingsSheet, pct: number): SavingsSheet {
  return s.income === null ? s : { ...s, pct, amount: amountOfPct(s.income, pct) };
}

/** Gõ số: thanh nhảy tới ⌊số × 100 ÷ lương⌋ (kẹp 1…100); số 0 / chưa hợp lệ giữ thanh. */
export function savingsSheetType(s: SavingsSheet, amount: number | null): SavingsSheet {
  return { ...s, amount, pct: s.income !== null && amount !== null && amount > 0 ? pctOfAmount(amount, s.income) : s.pct };
}

export function savingsSheetView(s: SavingsSheet): { warn: string | null; needsReason: boolean; problem: string | null; canSave: boolean } {
  const problem = amountProblem({ kind: "savings" }, s.amount, s.reason);
  return {
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

const plain = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[đĐ]/g, (ch) => (ch === "đ" ? "d" : "D"))
    .replace(/[^A-Za-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const memoTail = (c: Pick<PayCycleView, "payday">) => ` ky ${Number(c.payday.slice(8, 10))}-${Number(c.payday.slice(5, 7))}`;

/** Nội dung chuyển khoản không dấu: "Tich luy ky 10-11", "Hoc phi ky 10-11" (≤ 25 ký tự; tên dài thì cắt tên). */
export function taskMemo(c: Pick<PayCycleView, "payday">, t: PayCycleTask): string {
  const what = t.goal ? t.goal.name : t.kind === "surplus" && t.toAccountId !== null ? "Ví Thưởng" : t.kind === "move" && t.toPocket ? POCKET_LABEL[t.toPocket] : "Tích luỹ";
  const tail = memoTail(c);
  return `${plain(what).slice(0, 25 - tail.length).trim()}${tail}`;
}

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
export function taskQr(c: Pick<PayCycleView, "payday">, t: PayCycleTask, accountId?: string): TaskQr {
  return qrFor(t.targets, t.targetName, t.missing, taskMemo(c, t), accountId);
}

/** QR gộp các việc ② đang mở cùng tài khoản đích (pocket UC-1206 bước 10, AC-13): số = Σ phần còn thiếu, "Du phong ky {d-m}". */
export function goalGroupQr(c: Pick<PayCycleView, "payday" | "tasks">, accountId: string): TaskQr {
  const tasks = c.tasks.filter((t) => openGoalTask(t) && t.toAccountId === accountId);
  const first = tasks[0];
  if (!first) return { hint: null };
  return qrFor(first.targets, first.targetName, tasks.reduce((s, t) => s + t.missing, 0), `Du phong${memoTail(c)}`, accountId);
}

/** QR nhắc chuyển thêm (UC-702 AC-33, ADR-116): tới đích của `topUp`, số = phần của nguồn đó, "Bu chi tieu {d-m}" của hôm nay. */
export function topUpQr(t: TopUp, sourceAccountId: string, today: string): TaskQr {
  const amount = t.sources.find((x) => x.accountId === sourceAccountId)?.amount ?? 0;
  if (!t.target) return { hint: "Chuyển vào tiền chi tiêu" };
  return qrFor([t.target], t.target.name, amount, `Bu chi tieu ${Number(today.slice(8, 10))}-${Number(today.slice(5, 7))}`);
}

// ── Kiểm và thân yêu cầu ───────────────────────────────────────────

/** Lỗi của lý do bỏ qua: ① bắt buộc 1–500 ký tự; việc khác tuỳ chọn (≤ 500). */
export function skipProblem(t: Pick<PayCycleTask, "kind">, reason: string): string | null {
  const r = reason.trim();
  if (t.kind === "savings" && r === "") return SKIP_REASON_REQUIRED;
  if (r.length > REASON_MAX) return "Lý do tối đa 500 ký tự.";
  return null;
}

/** Lỗi của số mới: nguyên, 0..1e12; ① về 0 cần lý do. */
export function amountProblem(t: Pick<PayCycleTask, "kind">, amount: number | null, reason: string): string | null {
  if (amount === null || !Number.isInteger(amount) || amount < 0 || amount > AMOUNT_MAX) return "Số tiền không hợp lệ.";
  if (amount === 0) return skipProblem(t, reason);
  return reason.trim().length > REASON_MAX ? "Lý do tối đa 500 ký tự." : null;
}

export type TaskAction =
  | { kind: "done" }
  | { kind: "skip"; reason: string }
  | { kind: "reopen" }
  | { kind: "amount"; amount: number; reason: string };

/** Đường và thân yêu cầu của một thao tác; server trả `PayCycleView` mới. */
export function taskRequest(id: number, a: TaskAction): { method: "POST" | "PATCH"; path: string; body: Record<string, unknown> } {
  const base = `/v1/pay-cycle-tasks/${id}`;
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

/** Snapshot sau khi server trả kỳ mới: thay `payCycle`, giữ phần còn lại (số mỗi ngày tải lại sau). */
export const withPayCycle = <S extends Pick<Snapshot, "payCycle">>(s: S, view: PayCycleView): S => ({ ...s, payCycle: view });

/** Toast sau một lần ghi / gán từ `effects` (UC-706): "Kỳ lương mới từ 10/11 · 5 việc", "Đã ghi · Trích Tích luỹ ✓". */
export function effectsToast(effects: { cycle: { opened: boolean; startedAt: string; tasks: number } | null; tasksDone: { kind: PayCycleTask["kind"] }[] } | undefined): string | null {
  if (!effects) return null;
  if (effects.cycle?.opened) return `Kỳ lương mới từ ${shortDate(effects.cycle.startedAt)} · ${effects.cycle.tasks} việc`;
  if (effects.tasksDone.length === 0) return null;
  const names = [...new Set(effects.tasksDone.map((t) => TASK_SHORT[t.kind]))];
  return `Đã ghi · ${names.map((n) => `${n} ✓`).join(", ")}`;
}

const TASK_SHORT: Record<PayCycleTask["kind"], string> = { savings: "Trích Tích luỹ", goal: "Nạp mục tiêu", move: "Chuyển theo ngăn", surplus: "Chia dư kỳ trước" };
