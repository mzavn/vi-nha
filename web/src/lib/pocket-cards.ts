// Thẻ Tích luỹ và thẻ Dự phòng ở Hôm nay (pwa UC-702 bước 6–7, ADR-122, ADR-132), card "Tích luỹ" ở Ví & quỹ (UC-707): câu
// chữ từ `snapshot.pockets`, mỗi mục tiêu là một tài khoản thật. Thuần để test. Không có `pockets` → null (không có thẻ).
// Mục tiêu theo đúng thứ tự server.
// Mọi số tiền qua `moneyDigits` / `formatVnd` (che số, UC-718); %, số tháng, hạn không che.

import { peaceMonthsView, type PocketsView } from "../../../src/domain/pockets";
import { formatSigned, formatVnd } from "./money";
import { savingsDoneLine } from "./pay-cycle";
import { shortDate } from "./period";
import { dueText } from "./pockets";
import type { PayCycleView } from "./types";

const NBSP = "\u00a0";
const signedVnd = (n: number) => `${formatSigned(n)}${NBSP}₫`;

export const NO_SAVINGS_ACCOUNT = "Chưa có tài khoản Tích luỹ — mở một tài khoản thật rồi xếp vào ngăn Tích luỹ ›";

export interface SavingsCardView {
  total: string;
  /** Ngăn Tích luỹ không có tài khoản nào: thẻ chỉ có dòng `NO_SAVINGS_ACCOUNT` (→ Cài đặt › Ba ngăn). */
  empty: boolean;
  lines: { label: string; value: string }[];
  change: string;
  prev: string;
  pct: string;
  /** "Kỳ này đã trích ✓ …" / "Kỳ này chưa trích (…)" (UC-702); null khi chưa có kỳ có khoản lương sinh ①. */
  done: string | null;
}

export function savingsCard(p: PocketsView | undefined, cycle?: PayCycleView | null): SavingsCardView | null {
  if (!p) return null;
  const s = p.savings;
  return {
    total: formatVnd(s.total),
    empty: s.accounts.length === 0,
    lines: s.accounts.map((a) => ({ label: a.name, value: formatVnd(a.balance) })),
    // Mốc kỳ: `started_at` ISO của kỳ lương hoặc YYYY-MM-DD (chưa có kỳ) — hiện theo ngày giờ VN.
    change: `Kỳ này (từ ${shortDate(s.change.since)}): ${signedVnd(s.change.amount)}`,
    prev: `Kỳ trước: ${signedVnd(s.change.prevAmount)}`,
    pct: `Trích ${p.savingsPct}% mỗi kỳ lương`,
    done: savingsDoneLine(cycle, p.savingsPct),
  };
}

export interface ReserveGoalRow {
  id: string;
  /** Tên; mục tiêu theo % kèm "· 10% thu chịu thuế". */
  name: string;
  /** "đã có A / B trong {tài khoản}" (theo %: "đã có A trong {tài khoản}"); chưa gắn: "chưa có tài khoản". */
  amount: string;
  /** ⌊A × 100 ÷ B⌋, chặn 100; null khi theo % hoặc chưa gắn tài khoản. */
  pct: number | null;
  full: boolean;
  sub: string | null;
  /** Chưa gắn tài khoản thật: link "Mở tài khoản thật ›" (→ sheet mục tiêu). */
  needsAccount: boolean;
}

export interface ReserveCardView {
  total: string;
  empty: boolean;
  goals: ReserveGoalRow[];
  peace: { title: string; months: string | null; pct: number | null; note: string | null; bad: boolean };
  /** "Ví Thưởng 4.000.000 ₫"; null khi chưa chọn tài khoản Ví Thưởng. */
  reward: string | null;
}

function goalRow(g: PocketsView["reserve"]["goals"][number], accounts: PocketsView["reserve"]["accounts"]): ReserveGoalRow {
  const name = g.target === null ? `${g.name} · ${g.targetPct}% thu chịu thuế` : g.name;
  const repeat = g.monthly !== null && g.repeatMonths !== null ? (g.repeatMonths === 1 ? "mỗi tháng" : `${formatVnd(g.monthly)}/tháng, ${g.repeatMonths} tháng một lần`) : null;
  const sub = [g.dueDate ? `hạn ${dueText(g.dueDate)}` : null, repeat].filter(Boolean).join(" · ") || null;
  if (g.held === null) return { id: g.id, name, amount: "chưa có tài khoản", pct: null, full: false, sub, needsAccount: true };
  const where = accounts.find((a) => a.id === g.accountId)?.name ?? "";
  if (g.target === null) return { id: g.id, name, amount: `đã có ${formatVnd(g.held)} trong ${where}`, pct: null, full: false, sub, needsAccount: false };
  return {
    id: g.id,
    name,
    amount: `đã có ${formatVnd(g.held)} / ${formatVnd(g.target)} trong ${where}`,
    pct: g.target > 0 ? Math.max(0, Math.min(100, Math.floor((g.held * 100) / g.target))) : 100,
    full: g.held >= g.target,
    sub,
    needsAccount: false,
  };
}

export function reserveCard(p: PocketsView | undefined): ReserveCardView | null {
  if (!p) return null;
  const r = p.reserve;
  const { monthly, target, cycles } = r.peaceMonths;
  const view = peaceMonthsView(r.peace, monthly, target);
  const peace: ReserveCardView["peace"] =
    r.peace < 0
      ? { title: `Phần an tâm âm ${formatVnd(-r.peace)}`, months: null, pct: null, note: "Tài khoản Dự phòng không gắn mục tiêu đang âm", bad: true }
      : r.peace === 0
        ? { title: `Phần an tâm ${formatVnd(0)} — mọi tiền Dự phòng đã có hẹn`, months: null, pct: null, note: null, bad: false }
        : {
            title: `Phần an tâm ${formatVnd(r.peace)}`,
            months: view.covered === null ? null : `đủ ${view.covered.toFixed(1).replace(".", ",")} / ${target} tháng vận hành`,
            pct: view.pct,
            note: monthly === null ? "Chưa đủ một kỳ lương trọn để đo số tháng" : `chi vận hành trung bình ${formatVnd(monthly)}/kỳ (${cycles} kỳ gần nhất)`,
            bad: false,
          };
  return {
    total: formatVnd(r.total),
    empty: r.accounts.length === 0 && r.goals.length === 0,
    goals: r.goals.map((g) => goalRow(g, r.accounts)),
    peace,
    reward: r.reward ? `Ví Thưởng ${formatVnd(r.reward.balance)}` : null,
  };
}
