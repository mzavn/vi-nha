// Thẻ Vận hành ở Hôm nay (pwa UC-702, ADR-122, ADR-141): câu chữ từ `snapshot.nearSpend`, `snapshot.pockets` và `snapshot.topUp`.
// Thuần để test. Số theo ngày tính lại bằng `nearSpendView` theo hôm nay của máy — bản lưu cũ mở lúc mất mạng vẫn đúng số ngày.
// Mọi số tiền qua `moneyDigits` / `formatVnd` để che số (UC-718) che được cả trong câu chữ.

import { lateDays } from "../../../src/domain/pay-cycle";
import { blessingFor, type PocketsView } from "../../../src/domain/pockets";
import { nearSpendView, nextPayday, type NearSpend, type NearSpendCycle, type TopUp } from "../../../src/domain/snapshot";
import { formatVnd, moneyDigits } from "./money";
import { previousDay, shortDate } from "./period";

/** Dòng "Đã chừa … cho … khoản phải trả kỳ này ›" và danh sách khi chạm (mục tiêu trả từ tiền chi tiêu, ADR-141). */
export interface ReservedView {
  /** R > 0: "Đã chừa {R} cho {n} khoản phải trả kỳ này ›"; R = 0: "Các khoản phải trả kỳ này đã trả đủ ✓". */
  line: string;
  /** R = 0: không mở danh sách. */
  done: boolean;
  /** "{tên} · còn {R_g} / {mỗi tháng}" + "đã trả {đã chi}", theo thứ tự ưu tiên. */
  items: { id: string; title: string; spent: string }[];
}

/** Khối vàng nhắc chuyển thêm vào tiền chi tiêu (`snapshot.topUp`). */
export interface TopUpCardView {
  /** "Tiền chi tiêu sắp không đủ: cần chuyển thêm {Y}". */
  title: string;
  /** "từ {tên} {số}" (Ví Thưởng: "từ BIDV (Ví Thưởng) …"); `qr` = có đích để mở QR. */
  sources: { accountId: string; text: string; qr: boolean }[];
  /** Không có đích QR (vd chỉ tiền mặt): "Chuyển vào tiền chi tiêu". */
  hint: string | null;
  /** Nguồn không đủ: "{phần còn lại} chưa có nguồn". */
  missing: string | null;
}

export interface NearSpendCardView {
  head: string;
  /** Không có tài khoản nào ở ngăn Vận hành: thẻ chỉ có tiêu đề, câu `source` và Đổi ngăn. */
  noAccounts: boolean;
  /** Số to thứ nhất: tổng tiền vận hành. */
  amount: string | null;
  /** Số to thứ hai: "Chi khoảng X/ngày", câu hết tiền, hay "Chưa tới 1.000 ₫/ngày". */
  big: string | null;
  /** Phần số của "Chi khoảng X/ngày" — không ngắt dòng giữa số. */
  perDay: string | null;
  /** Hết tiền: số to thứ nhất tô đỏ. */
  out: boolean;
  sub: string | null;
  /** Mỗi câu một dòng (390px không ngắt giữa cụm); rỗng khi không có số. */
  meals: string[];
  payday: string | null;
  /** Nợ ngắn hạn cần trả — chỉ nhắc, không trừ vào hai số to. */
  debt: { line: string; next: string | null } | null;
  blessing: string | null;
  source: string;
  unconfirmed: string | null;
  /** Lương trễ (UC-702): "Lương dự kiến 10/12 chưa về (trễ 2 ngày)". */
  late: string | null;
  /** Phần chưa làm theo việc ngày lương đã trừ trước khi chia theo ngày. */
  pending: string | null;
  /** Mục tiêu trả từ tiền chi tiêu; null khi không có (hay bản lưu cũ thiếu `operating.goals`). */
  reserved: ReservedView | null;
  /** Nhắc chuyển thêm; null khi đủ tới ngày lương. */
  topUp: TopUpCardView | null;
}

/**
 * Dòng nợ ngắn hạn và "Sắp tới": khoản đầu có ngày trả ≥ hôm nay, không có thì khoản đầu có ngày trả. Mục tiêu Trả nợ gắn
 * tài khoản có tiền → "· đã có {số} trong {tài khoản}" (ADR-132).
 */
function debtLine(p: PocketsView, today: string): NearSpendCardView["debt"] {
  const d = p.shortDebt;
  const accountOf = (goalId: string | null) => p.reserve.accounts.find((a) => a.id === p.reserve.goals.find((g) => g.id === goalId)?.accountId)?.name ?? "";
  const held = d.items.filter((x) => x.heldFor > 0).map((x) => `đã có ${formatVnd(x.heldFor)} trong ${accountOf(x.goalId)}`);
  const day = Number(today.slice(8, 10));
  const dated = d.items.filter((x) => x.dueDay !== null);
  const soon = dated.find((x) => x.dueDay! >= day) ?? dated[0];
  return {
    line: `Nợ ngắn hạn còn ${formatVnd(d.total)} (${d.count} khoản)${held.length > 0 ? ` · ${held.join(", ")}` : ""}`,
    next: soon ? `Sắp tới: ${soon.name}${soon.monthlyPayment !== null ? ` trả ${formatVnd(soon.monthlyPayment)}` : ""} ngày ${soon.dueDay}` : null,
  };
}

/** Kỳ lương hiện tại của `nearSpend` (bản lưu cũ thiếu các trường: coi như chưa có kỳ, không R). */
export const nearSpendCycle = (ns: NearSpend): Required<NearSpendCycle> => ({ cyclePayday: ns.cyclePayday ?? null, pendingTasks: ns.pendingTasks ?? 0, goalRemaining: ns.goalRemaining ?? 0 });

function reservedView(p: PocketsView): ReservedView | null {
  const goals = p.operating.goals ?? [];
  if (goals.length === 0) return null;
  const total = goals.reduce((s, g) => s + g.remaining, 0);
  const open = goals.filter((g) => g.remaining > 0).length;
  return {
    line: total > 0 ? `Đã chừa ${formatVnd(total)} cho ${open} khoản phải trả kỳ này ›` : "Các khoản phải trả kỳ này đã trả đủ ✓",
    done: total === 0,
    items: goals.map((g) => ({ id: g.id, title: `${g.name} · còn ${moneyDigits(g.remaining)} / ${formatVnd(g.monthly)}`, spent: `đã trả ${formatVnd(g.spent)}` })),
  };
}

function topUpCard(t: TopUp, p: PocketsView): TopUpCardView {
  const rewardId = p.reserve.reward?.accountId ?? null;
  const qr = t.target !== null;
  const left = t.amount - t.sources.reduce((s, x) => s + x.amount, 0);
  return {
    title: `Tiền chi tiêu sắp không đủ: cần chuyển thêm ${formatVnd(t.amount)}`,
    sources: t.sources.map((x) => ({ accountId: x.accountId, text: `từ ${x.name}${x.accountId === rewardId && !x.name.includes("Ví Thưởng") ? " (Ví Thưởng)" : ""} ${formatVnd(x.amount)}`, qr })),
    hint: qr ? null : "Chuyển vào tiền chi tiêu",
    missing: left > 0 ? `${formatVnd(left)} chưa có nguồn` : null,
  };
}

export function nearSpendCard(ns: NearSpend, today: string, pockets: PocketsView, topUp: TopUp | null = null): NearSpendCardView {
  const cycle = nearSpendCycle(ns);
  const v = nearSpendView(ns.amount, today, ns.paydayDay, cycle);
  const late = cycle.cyclePayday ? lateDays(cycle.cyclePayday, today, ns.paydayDay) : 0;
  const [, pm, pd] = v.payday.split("-").map(Number);
  const head = `Vận hành tới kỳ lương ${pd}/${pm} · còn ${v.daysLeft} ngày`;
  if (ns.accounts.length === 0) {
    const none = { amount: null, big: null, perDay: null, sub: null, payday: null, debt: null, blessing: null, unconfirmed: null, late: null, pending: null, reserved: null, topUp: null };
    return { head, noAccounts: true, ...none, out: false, meals: [], source: "Chưa có tài khoản nào ở ngăn Vận hành" };
  }
  const out = ns.amount <= 0;
  const perDay = v.perDay === null ? null : `${moneyDigits(v.perDay)}/ngày`;
  return {
    head,
    noAccounts: false,
    amount: formatVnd(ns.amount),
    debt: pockets.shortDebt.count > 0 ? debtLine(pockets, today) : null,
    blessing: pockets.shortDebt.count === 0 ? blessingFor(today) : null,
    unconfirmed: pockets.unconfirmed > 0 ? `${pockets.unconfirmed} tài khoản chưa xác nhận ngăn` : null,
    late: late > 0 ? `Lương dự kiến ${shortDate(nextPayday(cycle.cyclePayday!, ns.paydayDay))} chưa về (trễ ${late} ngày)` : null,
    pending: v.pendingTasks > 0 ? `Chưa làm theo việc ngày lương: ${formatVnd(v.pendingTasks)} — chi khoảng tính trên phần còn lại` : null,
    // Ngày lương kế tiếp tính từ hôm qua là hôm nay ⇔ hôm nay là ngày lương.
    payday: nextPayday(previousDay(today), ns.paydayDay) === today ? "Hôm nay là ngày lương — lương về số sẽ tăng" : null,
    big: out ? `Tiền vận hành đã hết — còn ${v.daysLeft} ngày tới kỳ lương` : perDay === null ? "Chưa tới 1.000\u00a0₫/ngày" : `Chi khoảng ${perDay}`,
    perDay,
    out,
    sub: perDay === null ? null : "nếu không có gì đột xuất",
    meals: [
      v.perMeal !== null ? `Ăn 2 bữa: dưới ${moneyDigits(v.perMeal)}/bữa` : null,
      v.perMarket !== null ? `Đi chợ 1 lần/ngày: không quá ${moneyDigits(v.perMarket)}` : null,
    ].filter((line): line is string => line !== null),
    source: `Ở ${ns.accounts.map((a) => a.name).join(", ")}`,
    reserved: reservedView(pockets),
    topUp: topUp ? topUpCard(topUp, pockets) : null,
  };
}
