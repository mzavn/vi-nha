// Thẻ Tích luỹ và thẻ Dự phòng ở Hôm nay (pwa UC-702 bước 6–7, ADR-122, ADR-132), card "Tích luỹ" ở Ví & quỹ (UC-707): câu
// chữ từ `snapshot.pockets`, mỗi mục tiêu gắn một tài khoản thật, nhiều mục tiêu dùng chung được một tài khoản (nhóm theo
// `reserve.groups`). Thuần để test. Không có `pockets` → null (không có thẻ). Mục tiêu theo đúng thứ tự server.
// Mọi số tiền qua `moneyDigits` / `formatVnd` (che số, UC-718); %, số tháng, hạn không che.

import { peaceMonthsView, type PocketsView } from "../../../src/domain/pockets";
import { formatSigned, formatVnd } from "./money";
import { savingsDoneLine, savingsDoneWarn } from "./month-tasks";
import { shortDate } from "./period";
import { dueText } from "./pockets";
import type { MonthView } from "./types";

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
}

export function savingsCard(p: PocketsView | undefined, month?: MonthView | null): SavingsCardView | null {
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
  };
}

/** Câu chân nhóm tài khoản chung (UC-702 bước 7). */
export const SHARED_GROUP_NOTE = "Chia theo thứ tự ưu tiên: chi không chọn mục tiêu làm mục tiêu cuối thiếu trước.";

export interface ReserveGoalRow {
  id: string;
  /** Tên; mục tiêu theo % kèm "· 10% thu chịu thuế". */
  name: string;
  /**
   * "đã có A / B trong {tài khoản}" (theo %: "đã có A trong {tài khoản}"; trong nhóm chung bỏ "trong {tài khoản}"); A âm:
   * "chi vượt phần {|A|}"; chưa gắn: "chưa có tài khoản".
   */
  amount: string;
  /** ⌊(A + đã chi) × 100 ÷ B⌋, chặn 0…100; null khi theo % hoặc chưa gắn tài khoản. */
  pct: number | null;
  /** A + đã chi ≥ B. */
  full: boolean;
  /** A âm (đã chi vào phần của mục tiêu trước): `amount` hiện đỏ. */
  over: boolean;
  /** "đã chi {X} tháng này" khi đã chi > 0. */
  spent: string | null;
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
  peace: { title: string; months: string | null; pct: number | null; note: string | null; bad: boolean };
  /** "Ví Thưởng 4.000.000 ₫"; null khi chưa chọn tài khoản Ví Thưởng. */
  reward: string | null;
}

function goalRow(g: PocketsView["reserve"]["goals"][number], where: string | null): ReserveGoalRow {
  const name = g.target === null ? `${g.name} · ${g.targetPct}% thu chịu thuế` : g.name;
  const repeat = g.monthly !== null && g.repeatMonths !== null ? (g.repeatMonths === 1 ? "mỗi tháng" : `${formatVnd(g.monthly)}/tháng, ${g.repeatMonths} tháng một lần`) : null;
  const sub = [g.dueDate ? `hạn ${dueText(g.dueDate)}` : null, repeat].filter(Boolean).join(" · ") || null;
  if (g.held === null) return { id: g.id, name, amount: "chưa có tài khoản", pct: null, full: false, over: false, spent: null, sub, needsAccount: true };
  const inAccount = where === null ? "" : ` trong ${where}`;
  const spent = g.spent > 0 ? `đã chi ${formatVnd(g.spent)} tháng này` : null;
  const over = g.held < 0;
  const amount = (whole: string) => (over ? `chi vượt phần ${formatVnd(-g.held!)}` : whole);
  if (g.target === null) return { id: g.id, name, amount: amount(`đã có ${formatVnd(g.held)}${inAccount}`), pct: null, full: false, over, spent, sub, needsAccount: false };
  const part = g.held + g.spent;
  return {
    id: g.id,
    name,
    amount: amount(`đã có ${formatVnd(g.held)} / ${formatVnd(g.target)}${inAccount}`),
    pct: g.target > 0 ? Math.max(0, Math.min(100, Math.floor((part * 100) / g.target))) : 100,
    full: part >= g.target,
    over,
    spent,
    sub,
    needsAccount: false,
  };
}

/** Nhóm theo thứ tự mục tiêu: nhóm tài khoản xuất hiện ở mục tiêu đầu tiên của nó; mục tiêu chưa gắn đứng một mình. */
function reserveGroups(r: PocketsView["reserve"]): ReserveGroupView[] {
  const byGoal = new Map(r.groups.flatMap((grp) => grp.goalIds.map((id) => [id, grp] as const)));
  const goalById = new Map(r.goals.map((g) => [g.id, g]));
  const seen = new Set<string>();
  const out: ReserveGroupView[] = [];
  for (const g of r.goals) {
    const grp = byGoal.get(g.id);
    if (!grp) {
      out.push({ key: g.id, head: null, goals: [goalRow(g, null)], note: null, interest: null });
      continue;
    }
    if (seen.has(grp.accountId)) continue;
    seen.add(grp.accountId);
    const members = grp.goalIds.flatMap((id) => goalById.get(id) ?? []);
    const interest = grp.interest ? `Tiền lãi ${formatVnd(grp.interest)} (không tính vào mục tiêu)` : null;
    if (members.length < 2 && !grp.childIds?.length) {
      out.push({ key: grp.accountId, head: null, goals: members.map((m) => goalRow(m, grp.name)), note: null, interest });
      continue;
    }
    const state = grp.short ? `thiếu ${formatVnd(grp.short)}` : grp.extra ? `dư ${formatVnd(grp.extra)}` : "đủ";
    const meta = members.length < 2 ? state : `${members.length} mục tiêu · ${state}`;
    out.push({
      key: grp.accountId,
      head: { name: grp.name, balance: formatVnd(grp.balance), meta, tone: grp.short ? "warn" : "ok" },
      goals: members.map((m) => goalRow(m, null)),
      note: members.length < 2 ? null : SHARED_GROUP_NOTE,
      interest,
    });
  }
  return out;
}

export function reserveCard(p: PocketsView | undefined): ReserveCardView | null {
  if (!p) return null;
  const r = p.reserve;
  const { monthly, target, months } = r.peaceMonths;
  const view = peaceMonthsView(r.peace, monthly, target);
  const peace: ReserveCardView["peace"] =
    r.peace < 0
      ? { title: `Phần an tâm âm ${formatVnd(-r.peace)}`, months: null, pct: null, note: "Tài khoản Dự phòng không gắn mục tiêu đang âm", bad: true }
      : r.peace === 0
        ? { title: `Phần an tâm ${formatVnd(0)}, tiền Dự phòng đều đã có hẹn`, months: null, pct: null, note: null, bad: false }
        : {
            title: `Phần an tâm ${formatVnd(r.peace)}`,
            months: view.covered === null ? null : `đủ ${view.covered.toFixed(1).replace(".", ",")} / ${target} tháng vận hành`,
            pct: view.pct,
            note: monthly === null ? "Chưa đủ một tháng trọn để đo số tháng" : `chi vận hành trung bình ${formatVnd(monthly)}/tháng (${months} tháng trọn)`,
            bad: false,
          };
  return {
    total: formatVnd(r.total),
    empty: r.accounts.length === 0 && r.goals.length === 0,
    groups: reserveGroups(r),
    peace,
    reward: r.reward ? `Ví Thưởng ${formatVnd(r.reward.balance)}` : null,
  };
}
