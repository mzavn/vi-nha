// Khớp khoản chi vào mục tiêu Dự phòng (pocket UC-1209 AC-24…31; pwa UC-715 AC-21, UC-702 AC-45, UC-707 AC-45 / AC-46; ingest
// UC-305 AC-39): bộ chọn "Cho mục tiêu" gom theo tài khoản, hàng Cần xem (khoản chưa khớp, việc chuyển về), sheet Khớp giao dịch,
// toast có Hoàn tác. Thuần để test: không DOM, không mạng. Mọi số tiền qua `formatVnd` (che số, UC-718); ngày, số đếm không che.

import { transferQr } from "../../../src/domain/vietqr";
import { formatVnd } from "./money";
import { shortDate } from "./period";
import type { GoalCandidate, GoalMatchedTx, GoalMatchResult, GoalTxChange, Snapshot } from "./types";

type Pockets = Snapshot["pockets"];
type Refund = Pockets["reserve"]["refunds"][number];

export const NO_GOAL_PICK = "Không cho mục tiêu nào";
export const CLOSE_LABEL = "Chốt xong";
export const REOPEN_LABEL = "Mở lại";
export const REFUND_SKIP_REASON_REQUIRED = "Nhập lý do bỏ qua việc chuyển về.";

/** Chữ thường, bỏ dấu, đ → d: ô tìm gõ không dấu vẫn ra. */
const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "d")
    .toLowerCase()
    .trim();

const rootOf = (p: Pockets, accountId: string | null | undefined): string | null => {
  if (!accountId) return null;
  const line = [...p.reserve.accounts, ...p.operating.accounts, ...p.savings.accounts, ...p.outside.accounts].find((a) => a.id === accountId);
  return line?.parentId ?? accountId;
};

export interface GoalPickerGroup {
  accountId: string;
  name: string;
  /** Nhóm của chính tài khoản tiền ra (đứng đầu). */
  own: boolean;
  goals: { id: string; name: string }[];
}

/**
 * Bộ chọn "Cho mục tiêu" (UC-715 AC-21): mục tiêu tài khoản chưa chốt, gom theo tài khoản theo thứ tự nhóm của server; nhóm của
 * tài khoản tiền ra lên đầu. `query` lọc theo tên mục tiêu hoặc tên tài khoản (không dấu); nhóm rỗng bị bỏ.
 */
export function goalPickerGroups(p: Pockets | null | undefined, accountId: string | null | undefined, query: string): GoalPickerGroup[] {
  if (!p) return [];
  const root = rootOf(p, accountId);
  const q = fold(query);
  const byId = new Map(p.reserve.goals.map((g) => [g.id, g]));
  const groups = p.reserve.groups.flatMap((grp) => {
    const hitGroup = q !== "" && fold(grp.name).includes(q);
    const goals = grp.goalIds.flatMap((id) => {
      const g = byId.get(id);
      if (!g || g.closed) return [];
      return q === "" || hitGroup || fold(g.name).includes(q) ? [{ id: g.id, name: g.name }] : [];
    });
    return goals.length > 0 ? [{ accountId: grp.accountId, name: grp.name, own: grp.accountId === root, goals }] : [];
  });
  return [...groups.filter((g) => g.own), ...groups.filter((g) => !g.own)];
}

/** Id các mục tiêu chọn được trong bộ chọn (để kiểm giá trị trước khi gửi). */
export const pickableGoalIds = (p: Pockets | null | undefined): string[] => (p ? p.reserve.goals.filter((g) => g.accountId && !g.closed).map((g) => g.id) : []);

/** Tên mục tiêu đang gắn (tài khoản hoặc trả từ tiền chi tiêu); null = không gắn. */
export function goalNameOf(p: Pockets | null | undefined, goalId: string | null | undefined): string | null {
  if (!goalId) return null;
  const g = p?.reserve.goals.find((x) => x.id === goalId) ?? p?.operating.goals.find((x) => x.id === goalId);
  return g?.name ?? goalId;
}

// ── Toast và Hoàn tác ──────────────────────────────────────────────

/** "Đã khớp vào {mục tiêu}" / "Đã khớp N khoản vào {mục tiêu}", + "· chờ chuyển về X" khi tạo việc chuyển về (kiểu B). */
export function matchToast(goalName: string, res: Pick<GoalMatchResult, "changes" | "refunds_created">): string {
  const n = res.changes.length;
  const head = n > 1 ? `Đã khớp ${n} khoản vào ${goalName}` : `Đã khớp vào ${goalName}`;
  const pending = res.refunds_created.reduce((s, r) => s + r.amount, 0);
  return pending > 0 ? `${head} · chờ chuyển về ${formatVnd(pending)}` : head;
}

export const unmatchToast = (goalName: string, count: number): string => (count > 1 ? `Đã gỡ ${count} khoản khỏi ${goalName}` : `Đã gỡ khỏi ${goalName}`);
export const closeToast = (goalName: string): string => `Đã chốt xong ${goalName}`;
export const reopenToast = (goalName: string): string => `Đã mở lại ${goalName}`;

/** Đường PUT khớp / gỡ của một mục tiêu. */
export const goalTxPath = (goalId: string) => `/v1/goals/${encodeURIComponent(goalId)}/transactions`;

/**
 * Thân POST /v1/goals/:id/close | /reopen: mục tiêu lặp N tháng (N > 1) gửi đợt đang thấy (`period_id`, kể cả null) để server
 * bỏ qua lần bấm trên đợt đã qua; mục tiêu một lần / hằng tháng không gửi gì.
 */
export const closeBody = (g: { repeatMonths: number | null; periodId?: number | null }): { period_id?: number | null } =>
  (g.repeatMonths ?? 0) > 1 ? { period_id: g.periodId ?? null } : {};

/**
 * Hoàn tác một lần khớp / gỡ (`changes` của PUT): khoản trước đó chưa gắn → gỡ khỏi mục tiêu mới; trước đó ở mục tiêu khác → khớp
 * lại vào mục tiêu đó (server tự chuyển, Q2). Gom theo mục tiêu, giữ thứ tự gặp.
 */
export function undoRequests(changes: GoalTxChange[]): { path: string; body: { add?: number[]; remove?: number[] } }[] {
  const out = new Map<string, { path: string; body: { add?: number[]; remove?: number[] } }>();
  for (const c of changes) {
    const [goalId, op] = c.from_goal_id ? ([c.from_goal_id, "add"] as const) : c.to_goal_id ? ([c.to_goal_id, "remove"] as const) : [null, null];
    if (!goalId || !op) continue;
    const key = `${goalId}:${op}`;
    const req = out.get(key) ?? { path: goalTxPath(goalId), body: {} };
    req.body[op] = [...(req.body[op] ?? []), c.tx_id];
    out.set(key, req);
  }
  return [...out.values()];
}

// ── Hôm nay › Cần xem (UC-702 AC-45) ───────────────────────────────

export type NeedReviewGoalRow =
  | { kind: "unmatched"; key: string; accountId: string; goalIds: string[]; title: string }
  | { kind: "refund"; key: string; refundId: number; title: string; sub: string };

/**
 * Hàng "N khoản ở {T} chưa khớp mục tiêu" (chỉ nhóm có từ hai mục tiêu chưa chốt — server đặt `unmatched`; `goalIds` = mục tiêu
 * chưa chốt để chọn khi khớp) và "Chuyển X từ {T} về {V}" cho mỗi việc chuyển về đang mở (X = phần còn thiếu).
 */
export function needReviewGoalRows(p: Pockets | null | undefined, nameOf: (accountId: string) => string): NeedReviewGoalRow[] {
  if (!p) return [];
  const byId = new Map(p.reserve.goals.map((g) => [g.id, g]));
  const unmatched: NeedReviewGoalRow[] = p.reserve.groups.flatMap((grp) => {
    const open = grp.goalIds.filter((id) => byId.has(id) && !byId.get(id)!.closed);
    const n = grp.unmatched ?? 0;
    return n > 0 && open.length >= 2 ? [{ kind: "unmatched" as const, key: `unmatched-${grp.accountId}`, accountId: grp.accountId, goalIds: open, title: `${n} khoản ở ${grp.name} chưa khớp mục tiêu` }] : [];
  });
  const refunds: NeedReviewGoalRow[] = (p.reserve.refunds ?? [])
    .filter((r) => r.status === "open")
    .map((r) => ({ kind: "refund" as const, key: `refund-${r.id}`, refundId: r.id, title: refundTitle(r, nameOf), sub: `cho ${r.goalName}` }));
  return [...unmatched, ...refunds];
}

export const refundTitle = (r: Refund, nameOf: (accountId: string) => string): string =>
  `Chuyển ${formatVnd(r.missing)} từ ${nameOf(r.fromAccountId)} về ${nameOf(r.toAccountId)}`;

export type RefundQr = { amount: number; memo: string } & ({ payload: string; label: string } | { reason: string | null } | { hint: string });

/** Mã QR của việc chuyển về: tới tài khoản đã trả, số = phần còn thiếu, nội dung `CV {mã} T{tháng}`; riêng tư của người khác → không QR. */
export function refundQr(r: Refund): RefundQr {
  const base = { amount: r.missing, memo: r.memo };
  if (r.hidden || !r.qr) {
    return { ...base, hint: r.hidden ? `Một đầu là tài khoản riêng tư của người khác: chuyển theo nội dung ${r.memo}, không có mã QR.` : `Chuyển theo nội dung ${r.memo}.` };
  }
  const t = r.qr;
  return {
    ...base,
    ...transferQr({ amount: r.missing, memo: r.memo, to_name: t.name, to_kind: "bank", to_bank: t.bank, to_account_no: t.accountNo, to_sub_account: t.subAccount, to_sepay_enabled: t.subAccount !== null }),
  };
}

export const refundPath = (id: number, action: "done" | "skip" | "reopen") => `/v1/goal-refunds/${id}/${action}`;

export function refundToast(action: "done" | "skip", r: Refund, nameOf: (accountId: string) => string): string {
  const to = nameOf(r.toAccountId);
  return action === "done" ? `Đã chuyển ${formatVnd(r.missing)} về ${to}` : `Đã bỏ qua việc chuyển về ${to}`;
}

// ── Sheet mục tiêu và Khớp giao dịch (UC-707 AC-45 / AC-46) ────────

/** Dòng phụ hàng khoản đã khớp: "20/11 · VCB chung"; kiểu B: "2/11 · trả từ V chi tiêu". */
export const matchedRowSub = (t: GoalMatchedTx): string => `${shortDate(t.at)} · ${t.kind === "other" ? `trả từ ${t.account_name}` : t.account_name}`;

/** Nhãn của một khoản có thể khớp: từ tài khoản khác "từ {tài khoản} · sẽ chờ chuyển về"; đang ở mục tiêu khác "đang ở {mục tiêu}". */
export function candidateTag(c: GoalCandidate, goalId: string): string | null {
  const parts = [c.own ? null : `từ ${c.account_name} · sẽ chờ chuyển về`, c.goal_id && c.goal_id !== goalId ? `đang ở ${c.goal_name ?? c.goal_id}` : null].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : null;
}

/** Chân sheet "Khớp N khoản · Y"; chưa chọn → null. */
export function matchFooter(selected: Pick<GoalCandidate, "amount">[]): string | null {
  if (selected.length === 0) return null;
  return `Khớp ${selected.length} khoản · ${formatVnd(selected.reduce((s, c) => s + c.amount, 0))}`;
}

/**
 * Ô tìm của Khớp giao dịch → query của GET /v1/goals/:id/candidates: "20/11" (hay "5/1/2026") → một ngày `from`–`to`; chỉ chữ số
 * (dấu chấm / phẩy / cách phân nhóm) → `amount`; còn lại → `q`; rỗng → "" (mặc định: tài khoản mục tiêu, chưa gắn).
 */
export function candidateQuery(text: string, today: string): string {
  const t = text.trim();
  if (t === "") return "";
  const date = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?$/.exec(t);
  if (date) {
    const [, d, m, y] = date;
    const year = y ? (y.length === 2 ? `20${y}` : y) : today.slice(0, 4);
    const day = `${year}-${m!.padStart(2, "0")}-${d!.padStart(2, "0")}`;
    return new URLSearchParams({ from: day, to: day }).toString();
  }
  const digits = t.replace(/[.,\s]/g, "");
  if (/^\d+$/.test(digits)) return new URLSearchParams({ amount: String(Number(digits)) }).toString();
  return new URLSearchParams({ q: t }).toString();
}

export const candidatesPath = (goalId: string, query: string) => `/v1/goals/${encodeURIComponent(goalId)}/candidates${query ? `?${query}` : ""}`;
