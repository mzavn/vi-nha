// Thẻ Vận hành ở Hôm nay (pwa UC-702, ADR-122, ADR-141): câu chữ từ `snapshot.nearSpend`, `snapshot.pockets`, `snapshot.topUp`
// và `snapshot.moneyAge`. Thuần để test. Số theo ngày tính lại bằng `nearSpendView` theo hôm nay của máy — bản lưu cũ mở lúc mất
// mạng vẫn đúng số ngày. Mọi số tiền qua `moneyDigits` / `formatVnd` để che số (UC-718) che được cả trong câu chữ.

import type { MoneyAge } from "../../../src/domain/money-age";
import { blessingFor, type PocketsView } from "../../../src/domain/pockets";
import { nearSpendView, nextPayday, type NearSpend, type NearSpendContext, type TopUp } from "../../../src/domain/snapshot";
import { formatVnd, moneyDigits } from "./money";
import { previousDay } from "./period";

/** Hàng "Khoản phải trả tháng này" và danh sách khi chạm (mục tiêu trả từ tiền chi tiêu, ADR-141, ADR-143). */
export interface ReservedView {
  /** R > 0: "còn {R}" + `note` "{n} khoản chưa trả xong"; R = 0: "đã trả đủ", `note` null. */
  value: string;
  note: string | null;
  /** R = 0 (vẫn mở được danh sách để đặt số tháng này). */
  done: boolean;
  /**
   * "{tên} · còn {R_g} / {số tháng này}" + "đã trả {đã trả}", theo thứ tự ưu tiên; có số riêng tháng này thì thêm `month`
   * "tháng này {số} · mỗi tháng {số} · {lý do}".
   */
  items: { id: string; title: string; spent: string; month?: string }[];
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

/** Chú thích hàng tuổi tiền (UC-702 AC-41). */
export const MONEY_AGE_NOTE = "Đủ 30 ngày là nhà đang sống bằng lương tháng trước";

export interface NearSpendCardView {
  /** "{n} ngày tới lương {d}/{m}" — dòng phụ dưới số chính, sau "còn {tổng}". */
  days: string;
  /** Không có tài khoản nào ở ngăn Vận hành: thẻ chỉ có tiêu đề, dòng ngày, câu `source` và Đổi ngăn. */
  noAccounts: boolean;
  /** Tổng tiền vận hành ("còn {tổng}" ở dòng phụ). */
  amount: string | null;
  /** Số chính: "Chi khoảng X/ngày", câu hết tiền, hay "Chưa tới 1.000 ₫/ngày". */
  big: string | null;
  /** Phần số của "Chi khoảng X/ngày" — không ngắt dòng giữa số. */
  perDay: string | null;
  /** Hết tiền: tổng tô đỏ. */
  out: boolean;
  sub: string | null;
  /** Hai ô gợi ý hôm nay (nhãn nhỏ, số đậm); rỗng khi không có số. */
  meals: { label: string; value: string }[];
  payday: string | null;
  /** Nợ ngắn hạn cần trả — chỉ nhắc, không trừ vào số chính: tổng, "{n} khoản · đã có … trong …", "Sắp tới: …". */
  debt: { value: string; sub: string; next: string | null } | null;
  blessing: string | null;
  source: string;
  unconfirmed: string | null;
  /** Phần chưa chuyển theo nhắc trích / chia dư (`pendingTasks`) đã trừ trước khi chia theo ngày. */
  pending: string | null;
  /** Tuổi tiền (chỉ đo, UC-702 AC-41): "{n} ngày" + chú thích; null khi `moneyAge` null. */
  age: { value: string; note: string } | null;
  /** Mục tiêu trả từ tiền chi tiêu; null khi không có (hay bản lưu cũ thiếu `operating.goals`). */
  reserved: ReservedView | null;
  /** Nhắc chuyển thêm; null khi đủ tới ngày lương. */
  topUp: TopUpCardView | null;
}

/**
 * Hàng nợ ngắn hạn và "Sắp tới": khoản đầu có ngày trả ≥ hôm nay, không có thì khoản đầu có ngày trả. Mục tiêu Trả nợ gắn
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
    value: formatVnd(d.total),
    sub: [`${d.count} khoản`, ...held].join(" · "),
    next: soon ? `Sắp tới: ${soon.name}${soon.monthlyPayment !== null ? ` trả ${formatVnd(soon.monthlyPayment)}` : ""} ngày ${soon.dueDay}` : null,
  };
}

/** Luật số ngày của `nearSpend` (ledger UC-103): lương về sớm, phần chưa chuyển, R. */
export const nearSpendContext = (ns: NearSpend): Required<NearSpendContext> => ({ salaryPayday: ns.salaryPayday ?? null, pendingTasks: ns.pendingTasks ?? 0, goalRemaining: ns.goalRemaining ?? 0 });

function reservedView(p: PocketsView): ReservedView | null {
  const goals = p.operating.goals ?? [];
  if (goals.length === 0) return null;
  const total = goals.reduce((s, g) => s + g.remaining, 0);
  const open = goals.filter((g) => g.remaining > 0).length;
  return {
    value: total > 0 ? `còn ${formatVnd(total)}` : "đã trả đủ",
    note: total > 0 ? `${open} khoản chưa trả xong` : null,
    done: total === 0,
    items: goals.map((g) => {
      const item = { id: g.id, title: `${g.name} · còn ${moneyDigits(g.remaining)} / ${formatVnd(g.monthAmount ?? g.monthly)}`, spent: `đã trả ${formatVnd(g.spent)}` };
      if (g.monthAmount === null) return item;
      return { ...item, month: [`tháng này ${formatVnd(g.monthAmount)}`, `mỗi tháng ${formatVnd(g.monthly)}`, ...(g.note ? [g.note] : [])].join(" · ") };
    }),
  };
}

/** Thân `PUT /v1/goal-month-amounts/:goalId` (UC-702 AC-37): lý do bỏ dấu cách hai đầu, rỗng → null; `amount` null = về số mỗi tháng. */
export function monthAmountBody(amount: number | null, note: string): { amount: number | null; note: string | null } {
  return { amount, note: amount === null ? null : note.trim() || null };
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

/** Hàng tuổi tiền: "12 ngày"; từ 30 ngày chú thích "Đủ đệm một tháng, nhà đang sống bằng lương tháng trước". */
function ageView(age: MoneyAge | null): NearSpendCardView["age"] {
  if (!age) return null;
  return { value: `${age.days} ngày`, note: age.buffered ? "Đủ đệm một tháng, nhà đang sống bằng lương tháng trước" : MONEY_AGE_NOTE };
}

export function nearSpendCard(ns: NearSpend, today: string, pockets: PocketsView, topUp: TopUp | null = null, moneyAge: MoneyAge | null = null): NearSpendCardView {
  const v = nearSpendView(ns.amount, today, ns.paydayDay, nearSpendContext(ns));
  const [, pm, pd] = v.payday.split("-").map(Number);
  const days = `${v.daysLeft} ngày tới lương ${pd}/${pm}`;
  if (ns.accounts.length === 0) {
    const none = { amount: null, big: null, perDay: null, sub: null, payday: null, debt: null, blessing: null, unconfirmed: null, pending: null, age: null, reserved: null, topUp: null };
    return { days, noAccounts: true, ...none, out: false, meals: [], source: "Chưa có tài khoản nào ở ngăn Vận hành" };
  }
  const out = ns.amount <= 0;
  const perDay = v.perDay === null ? null : `${moneyDigits(v.perDay)}/ngày`;
  return {
    days,
    noAccounts: false,
    amount: formatVnd(ns.amount),
    debt: pockets.shortDebt.count > 0 ? debtLine(pockets, today) : null,
    blessing: pockets.shortDebt.count === 0 ? blessingFor(today) : null,
    unconfirmed: pockets.unconfirmed > 0 ? `${pockets.unconfirmed} tài khoản chưa xác nhận ngăn` : null,
    pending: v.pendingTasks > 0 ? `Chưa chuyển theo nhắc: ${formatVnd(v.pendingTasks)}, chi khoảng tính trên phần còn lại` : null,
    age: ageView(moneyAge),
    // Ngày lương kế tiếp tính từ hôm qua là hôm nay ⇔ hôm nay là ngày lương.
    payday: nextPayday(previousDay(today), ns.paydayDay) === today ? "Hôm nay là ngày lương, lương về số sẽ tăng" : null,
    big: out ? `Tiền vận hành đã hết, còn ${v.daysLeft} ngày tới ngày lương` : perDay === null ? "Chưa tới 1.000\u00a0₫/ngày" : `Chi khoảng ${perDay}`,
    perDay,
    out,
    sub: perDay === null ? null : "nếu không có gì đột xuất",
    meals: [
      ...(v.perMeal !== null ? [{ label: "Ăn 2 bữa · mỗi bữa", value: `dưới ${moneyDigits(v.perMeal)}` }] : []),
      ...(v.perMarket !== null ? [{ label: "Đi chợ 1 lần/ngày", value: `tối đa ${moneyDigits(v.perMarket)}` }] : []),
    ],
    source: `Ở ${ns.accounts.map((a) => a.name).join(", ")}`,
    reserved: reservedView(pockets),
    topUp: topUp ? topUpCard(topUp, pockets) : null,
  };
}
