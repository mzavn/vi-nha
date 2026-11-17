// Thẻ Tích luỹ và thẻ Dự phòng (pwa UC-702 bước 6–7, ADR-122, ADR-132), card "Tích luỹ" ở Tài khoản › Ba ngăn (UC-707): câu
// chữ từ `snapshot.pockets`, mỗi mục tiêu gắn một tài khoản thật, nhiều mục tiêu dùng chung được một tài khoản (nhóm theo
// `reserve.groups`). Thuần để test. Không có `pockets` → null (không có thẻ). Mục tiêu theo đúng thứ tự server.
// Mọi số tiền qua `moneyDigits` / `formatVnd` (che số, UC-718); %, số tháng, hạn không che.

import type { PocketsView } from "../../../src/domain/pockets";
import { cushionLine } from "./freedom";
import { formatSigned, formatVnd, moneyDigits } from "./money";
import { savingsDoneLine, savingsDoneWarn } from "./month-tasks";
import { shortDate } from "./period";
import { dueText } from "./pockets";
import type { FreedomParams, MonthView } from "./types";

const NBSP = "\u00a0";
const signedVnd = (n: number) => `${formatSigned(n)}${NBSP}₫`;

export const NO_SAVINGS_ACCOUNT = "Chưa có tài khoản Tích luỹ. Mở tài khoản thật rồi xếp vào ngăn Tích luỹ ›";

export interface SavingsCardView {
  total: string;
  /** Ngăn Tích luỹ không có tài khoản nào: thẻ chỉ có dòng `NO_SAVINGS_ACCOUNT` (→ Cài đặt › Ba ngăn). */
  empty: boolean;
  lines: { label: string; value: string }[];
  change: string;
  prev: string;
  pct: string;
  /** "Tháng 12 đã trích 3.500.000 ₫ · 10% lương · mức 10–30%" / "Tháng 12 chưa trích (…)" (UC-702 AC-40); null khi tháng chưa có khoản lương sinh ①. */
  done: string | null;
  /** Mức "dưới 1%" (ADR-142): dòng `done` tô vàng. */
  doneWarn: boolean;
  /** Dòng đệm (UC-707 AC-47): "Đủ 0,5 tháng chi · mốc Khởi đầu 1E"; null khi chưa tải được `GET /v1/freedom`. */
  cushion: string | null;
}

/** `ladder`: `params` của `GET /v1/freedom` (chi phí tháng, ba mốc đệm); null / thiếu → không có dòng đệm. */
export function savingsCard(p: PocketsView | undefined, month?: MonthView | null, ladder?: Pick<FreedomParams, "expenseMonthly" | "safetyMonths"> | null): SavingsCardView | null {
  if (!p) return null;
  const s = p.savings;
  return {
    total: formatVnd(s.total),
    empty: s.accounts.length === 0,
    lines: s.accounts.map((a) => ({ label: a.name, value: formatVnd(a.balance) })),
    // Mốc tháng: "YYYY-MM-01" của tháng này (UC-1203).
    change: `Tháng này (từ ${shortDate(s.change.since)}): ${signedVnd(s.change.amount)}`,
    prev: `Tháng trước: ${signedVnd(s.change.prevAmount)}`,
    pct: `Trích ${p.savingsPct}% mỗi khoản lương`,
    done: savingsDoneLine(month, p.savingsPct),
    doneWarn: savingsDoneWarn(month),
    cushion: ladder ? cushionLine(s.total, ladder.expenseMonthly, ladder.safetyMonths) : null,
  };
}

/** Câu chân nhóm tài khoản chung (UC-702 bước 7). */
export const SHARED_GROUP_NOTE = "Chia theo thứ tự ưu tiên: chi không chọn mục tiêu làm mục tiêu cuối thiếu trước.";

export interface ReserveGoalRow {
  id: string;
  /** Tên; mục tiêu theo % kèm "· 10% thu chịu thuế". */
  name: string;
  /**
   * Một dòng phụ (K-010), gọn cho 390px: chưa chốt "X + Y / Z ₫" (chỉ số cuối có ₫; bỏ "+ Y" khi chưa chi; một mục tiêu một mình
   * kèm "trong {tài khoản}"; theo %: "đã có X trong {tài khoản}"); số dư âm mà chưa khớp khoản nào: "chi vượt phần {|X|}"; đã chốt
   * "Xong · dư W" / "Xong · vượt W" / "Xong"; chưa gắn: "chưa có tài khoản". Nhãn đầy đủ ở `details`.
   */
  amount: string;
  /** Phần trạng thái nối sau `amount` trên cùng dòng: "chờ chuyển về X", "thiếu W vì {mục tiêu} chi vượt" (vàng), "đã quá hạn N ngày" (vàng). */
  status: { text: string; tone: "warn" | null }[];
  /** Sheet mục tiêu: "Có X + đã chi Y / cần Z" (đã chốt: "Xong · đã chi Y / cần Z · dư / vượt W"), "Trả từ {tài khoản} X · chờ chuyển về X". */
  details: string[];
  /** ⌊(X + Y) × 100 ÷ Z⌋, chặn 0…100; null khi theo %, chưa gắn tài khoản hay đã chốt. */
  pct: number | null;
  /** X + Y ≥ Z (chưa chốt). */
  full: boolean;
  /** Số dư âm mà chưa khớp khoản nào (đã chi 0): `amount` hiện đỏ. */
  over: boolean;
  /** Đã chốt xong: sheet mục tiêu có "Mở lại"; chưa chốt có "Chốt xong". */
  closed: boolean;
  /** Server gợi ý chốt (đã chi ≥ cần): chip "Đã chi đủ" bên phải hàng. */
  suggestClose: boolean;
  sub: string | null;
  /** Chưa gắn tài khoản thật: link "Mở tài khoản thật ›" (→ sheet mục tiêu). */
  needsAccount: boolean;
}

/** Một nhóm hàng của thẻ: tài khoản chung (có dòng nhóm + câu chân) hoặc một mục tiêu một mình (`head` / `note` null). */
export interface ReserveGroupView {
  key: string;
  /**
   * Dòng nhóm dạng nhãn – số (DESIGN §4.5): `name` tài khoản trái, `balance` số dư gộp (gồm khoản gửi kỳ hạn) phải, `meta`
   * một dòng phụ "{n} mục tiêu · thiếu X / đủ / dư X" (`tone` warn khi thiếu); một mục tiêu ở tài khoản có khoản gửi cũng có
   * dòng nhóm, `meta` chỉ "thiếu X / đủ / dư X".
   */
  head: { name: string; balance: string; meta: string; tone: "warn" | "ok" } | null;
  goals: ReserveGoalRow[];
  note: string | null;
  /** "Tiền lãi {I} (không tính vào mục tiêu)" khi tiền lãi của nhóm > 0 (QĐ2). */
  interest: string | null;
}

export interface ReserveCardView {
  total: string;
  empty: boolean;
  groups: ReserveGroupView[];
  /** "Chưa gắn mục tiêu X ₫" (tài khoản Dự phòng không gắn mục tiêu, `reserve.peace`); âm → "… âm X ₫" đỏ; 0 → null (không hàng). */
  unassigned: { text: string; bad: boolean } | null;
  /** "Ví Thưởng 4.000.000 ₫"; null khi chưa chọn tài khoản Ví Thưởng. */
  reward: string | null;
}

/** Số ngày từ `due` tới `today` (YYYY-MM-DD, ngày VN); dương = đã quá. */
const daysPast = (due: string, today: string) => Math.round((Date.parse(today.slice(0, 10)) - Date.parse(due.slice(0, 10))) / 86_400_000);

type ReserveGoalView = PocketsView["reserve"]["goals"][number];

function goalStatus(g: ReserveGoalView, nameOf: (id: string) => string, today: string | null): ReserveGoalRow["status"] {
  const out: ReserveGoalRow["status"] = [];
  if ((g.pendingRefund ?? 0) > 0) out.push({ text: `chờ chuyển về ${formatVnd(g.pendingRefund!)}`, tone: null });
  if (g.closed) return out;
  for (const s of g.shortBecause ?? []) out.push({ text: `thiếu ${formatVnd(s.amount)} vì ${nameOf(s.goalId)} chi vượt`, tone: "warn" });
  // Chỉ mục tiêu lặp N tháng (Q1): hạn là hạn của đợt hiện tại; mục tiêu hằng tháng về 0 mỗi tháng như cũ.
  if (today && g.dueDate && (g.repeatMonths ?? 0) > 1) {
    const n = daysPast(g.dueDate, today);
    if (n > 0) out.push({ text: `đã quá hạn ${n} ngày`, tone: "warn" });
  }
  return out;
}

function goalDetails(g: ReserveGoalView, need: number | null): string[] {
  const out: string[] = [];
  if (need !== null && g.closed) {
    const rest = (g.leftover ?? 0) > 0 ? ` · dư ${formatVnd(g.leftover!)}` : (g.over ?? 0) > 0 ? ` · vượt ${formatVnd(g.over!)}` : "";
    out.push(`Xong · đã chi ${formatVnd(g.spent)} / cần ${formatVnd(need)}${rest}`);
  } else if (need !== null) out.push(`Có ${formatVnd(Math.max(0, g.held ?? 0))} + đã chi ${formatVnd(g.spent)} / cần ${formatVnd(need)}`);
  if ((g.advance ?? 0) > 0) {
    const from = (g.advanceFrom ?? []).join(", ");
    const paid = `Trả từ ${from ? `${from} ` : ""}${formatVnd(g.advance!)}`;
    out.push((g.pendingRefund ?? 0) > 0 ? `${paid} · chờ chuyển về ${formatVnd(g.pendingRefund!)}` : paid);
  }
  return out;
}

function goalRow(g: ReserveGoalView, where: string | null, nameOf: (id: string) => string, today: string | null): ReserveGoalRow {
  const name = g.target === null ? `${g.name} · ${g.targetPct}% thu chịu thuế` : g.name;
  const repeat = g.monthly !== null && g.repeatMonths !== null ? (g.repeatMonths === 1 ? "mỗi tháng" : `${formatVnd(g.monthly)}/tháng, ${g.repeatMonths} tháng một lần`) : null;
  const sub = [g.dueDate ? `hạn ${dueText(g.dueDate)}` : null, repeat].filter(Boolean).join(" · ") || null;
  const closed = !!g.closed;
  const need = g.held === null || g.target === null ? null : (g.need ?? g.target);
  const base = { id: g.id, name, status: goalStatus(g, nameOf, today), details: goalDetails(g, need), closed, suggestClose: !closed && !!g.suggestClose, sub };
  if (g.held === null) return { ...base, amount: "chưa có tài khoản", pct: null, full: false, over: false, needsAccount: true };
  const inAccount = where === null ? "" : ` trong ${where}`;
  // "Chi vượt phần" chỉ khi số dư âm thật mà mục tiêu chưa khớp khoản nào (luật cũ UC-702 AC-31).
  const over = g.held < 0 && g.spent === 0;
  if (need === null) return { ...base, amount: over ? `chi vượt phần ${formatVnd(-g.held)}` : `đã có ${formatVnd(g.held)}${inAccount}`, pct: null, full: false, over, needsAccount: false };
  if (closed) {
    const rest = (g.leftover ?? 0) > 0 ? ` · dư ${formatVnd(g.leftover!)}` : (g.over ?? 0) > 0 ? ` · vượt ${formatVnd(g.over!)}` : "";
    return { ...base, amount: `Xong${rest}`, pct: null, full: false, over: false, needsAccount: false };
  }
  const part = g.held + g.spent;
  // Hàng gọn ở 390px: "X + Y / Z ₫" — chỉ số cuối có ₫, nhãn đầy đủ ở sheet (`details`).
  const spent = g.spent > 0 ? ` + ${moneyDigits(g.spent)}` : "";
  return {
    ...base,
    amount: over ? `chi vượt phần ${formatVnd(-g.held)}` : `${moneyDigits(Math.max(0, g.held))}${spent} / ${formatVnd(need)}${inAccount}`,
    pct: need > 0 ? Math.max(0, Math.min(100, Math.floor((part * 100) / need))) : 100,
    full: part >= need,
    over,
    needsAccount: false,
  };
}

/** Nhóm theo thứ tự mục tiêu: nhóm tài khoản xuất hiện ở mục tiêu đầu tiên của nó; mục tiêu chưa gắn đứng một mình. */
function reserveGroups(r: PocketsView["reserve"], today: string | null): ReserveGroupView[] {
  const byGoal = new Map(r.groups.flatMap((grp) => grp.goalIds.map((id) => [id, grp] as const)));
  const goalById = new Map(r.goals.map((g) => [g.id, g]));
  const nameOf = (id: string) => goalById.get(id)?.name ?? id;
  const row = (g: ReserveGoalView, where: string | null) => goalRow(g, where, nameOf, today);
  const seen = new Set<string>();
  const out: ReserveGroupView[] = [];
  for (const g of r.goals) {
    const grp = byGoal.get(g.id);
    if (!grp) {
      out.push({ key: g.id, head: null, goals: [row(g, null)], note: null, interest: null });
      continue;
    }
    if (seen.has(grp.accountId)) continue;
    seen.add(grp.accountId);
    const members = grp.goalIds.flatMap((id) => goalById.get(id) ?? []);
    const interest = grp.interest ? `Tiền lãi ${formatVnd(grp.interest)} (không tính vào mục tiêu)` : null;
    if (members.length < 2 && !grp.childIds?.length) {
      out.push({ key: grp.accountId, head: null, goals: members.map((m) => row(m, grp.name)), note: null, interest });
      continue;
    }
    const state = grp.short ? `thiếu ${formatVnd(grp.short)}` : grp.extra ? `dư ${formatVnd(grp.extra)}` : "đủ";
    const meta = members.length < 2 ? state : `${members.length} mục tiêu · ${state}`;
    out.push({
      key: grp.accountId,
      head: { name: grp.name, balance: formatVnd(grp.balance), meta, tone: grp.short ? "warn" : "ok" },
      goals: members.map((m) => row(m, null)),
      note: members.length < 2 ? null : SHARED_GROUP_NOTE,
      interest,
    });
  }
  return out;
}

/** `today` (YYYY-MM-DD, ngày VN): để tính "đã quá hạn N ngày"; thiếu thì không có dòng đó. */
export function reserveCard(p: PocketsView | undefined, today: string | null = null): ReserveCardView | null {
  if (!p) return null;
  const r = p.reserve;
  const unassigned = r.peace === 0 ? null : { text: r.peace < 0 ? `Chưa gắn mục tiêu âm ${formatVnd(-r.peace)}` : `Chưa gắn mục tiêu ${formatVnd(r.peace)}`, bad: r.peace < 0 };
  return {
    total: formatVnd(r.total),
    empty: r.accounts.length === 0 && r.goals.length === 0,
    groups: reserveGroups(r, today),
    unassigned,
    reward: r.reward ? `Ví Thưởng ${formatVnd(r.reward.balance)}` : null,
  };
}
