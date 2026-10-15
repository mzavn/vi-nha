// Chốt tháng (allocation UC-207, ADR-111): người bấm chốt tháng liền trước. Hàm THUẦN, không đọc DB.
//   Bước 1 — bù ví chi lố: phong bì chung dương góp theo tỷ lệ số dư để lấp hố của phong bì chung âm (đổ thác).
//   Bước 2 — phần dư (Lợi nhuận thêm) của từng ví dương: X% vào Tích sản, còn lại vào Ví Thưởng.
// Ví cá nhân, ví tích dồn, ví hoá đơn và Ví Thưởng đứng ngoài.

import type { WalletRef } from "./types";

export interface MonthClosePlanInput {
  /** Ví đang dùng. */
  wallets: WalletRef[];
  /** Số dư cộng dồn tới hết tháng được chốt. */
  balances: Record<string, number>;
  /** Σ fund còn hiệu lực vào từng ví trong tháng sau — lương sau đã bù thì chốt không bù lại. */
  coveredByNextIncome: Record<string, number>;
  /** 0..100, service đã kiểm. */
  wealthPct: number;
  wealthWalletId: string;
  /** null ⇒ wealthPct phải là 100. */
  rewardWalletId: string | null;
}

export interface MonthCloseCover {
  fromWalletId: string;
  toWalletId: string;
  amount: number;
}

export interface MonthCloseSweep {
  fromWalletId: string;
  toWalletId: string;
  kind: "wealth" | "reward";
  amount: number;
}

export interface MonthCloseParticipantPlan {
  walletId: string;
  monthEndBalance: number;
  /** Phần âm còn phải bù sau khi trừ phần lương tháng sau đã rót. */
  hole: number;
  coveredByNextIncome: number;
  contributed: number;
  coverReceived: number;
  toWealth: number;
  toReward: number;
}

export interface MonthClosePlan {
  participants: MonthCloseParticipantPlan[];
  positiveTotal: number;
  holeTotal: number;
  covered: number;
  profit: number;
  toWealth: number;
  toReward: number;
  /** Theo thứ tự ghép đổ thác. */
  covers: MonthCloseCover[];
  /** Theo thứ tự ví dương; mỗi ví tối đa một dòng Tích sản và một dòng Ví Thưởng. */
  sweeps: MonthCloseSweep[];
}

/** Phong bì chung phe Must (cả Có thì tốt) hoặc Hưởng thụ — ví tham gia chốt tháng (trừ Ví Thưởng). */
export function isMonthCloseParticipant(w: Pick<WalletRef, "kind" | "scope" | "tier">): boolean {
  return w.kind === "envelope" && w.scope === "shared" && (w.tier === "must" || w.tier === "nice");
}

/** % phần dư vào Tích sản khi chưa đặt `config.month_close_wealth_pct`. */
export const DEFAULT_MONTH_CLOSE_WEALTH_PCT = 50;

/**
 * Ví Thưởng hợp lệ (ngoài điều kiện đang dùng): ví chung, không riêng tư, phe Must / Hưởng thụ, không phải phong bì
 * (phong bì chung tham gia chốt). Ví cá nhân không được nhận phần dư của cả nhà.
 */
export function isRewardWalletCandidate(w: Pick<WalletRef, "kind" | "scope" | "tier" | "private">): boolean {
  return (w.tier === "must" || w.tier === "nice") && w.scope === "shared" && !w.private && w.kind !== "envelope";
}

export function planMonthClose(input: MonthClosePlanInput): MonthClosePlan {
  const { wealthPct, rewardWalletId } = input;
  if (wealthPct < 100 && rewardWalletId === null) throw new Error("Bất biến vỡ: chưa có Ví Thưởng mà phần dư vào Tích sản dưới 100%.");

  const rows = input.wallets
    .filter((w) => isMonthCloseParticipant(w) && w.id !== rewardWalletId)
    .map((w) => {
      const balance = input.balances[w.id] ?? 0;
      const deficit = Math.max(0, -balance);
      const coveredByNextIncome = Math.min(deficit, Math.max(0, input.coveredByNextIncome[w.id] ?? 0));
      return { wallet: w, row: { walletId: w.id, monthEndBalance: balance, hole: deficit - coveredByNextIncome, coveredByNextIncome, contributed: 0, coverReceived: 0, toWealth: 0, toReward: 0 } };
    });
  const tieBreak = (a: WalletRef, b: WalletRef) => a.sort - b.sort || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const positives = rows.filter((r) => r.row.monthEndBalance > 0).sort((a, b) => b.row.monthEndBalance - a.row.monthEndBalance || tieBreak(a.wallet, b.wallet));
  const holes = rows.filter((r) => r.row.hole > 0).sort((a, b) => b.row.hole - a.row.hole || tieBreak(a.wallet, b.wallet));

  const positiveTotal = positives.reduce((s, r) => s + r.row.monthEndBalance, 0);
  const holeTotal = holes.reduce((s, r) => s + r.row.hole, 0);
  const covered = Math.min(positiveTotal, holeTotal);

  // Bước 1: phần góp theo tỷ lệ số dư, đồng lẻ vào ví dương đứng đầu; rồi ghép đổ thác.
  if (covered > 0) {
    let given = 0;
    for (const p of positives) {
      p.row.contributed = Math.floor((covered * p.row.monthEndBalance) / positiveTotal);
      given += p.row.contributed;
    }
    positives[0]!.row.contributed += covered - given;
  }
  const covers: MonthCloseCover[] = [];
  let j = 0;
  let holeLeft = holes[0]?.row.hole ?? 0;
  for (const p of positives) {
    let left = p.row.contributed;
    while (left > 0 && j < holes.length) {
      const amount = Math.min(left, holeLeft);
      covers.push({ fromWalletId: p.row.walletId, toWalletId: holes[j]!.row.walletId, amount });
      holes[j]!.row.coverReceived += amount;
      left -= amount;
      holeLeft -= amount;
      if (holeLeft === 0) holeLeft = holes[++j]?.row.hole ?? 0;
    }
  }

  // Bước 2: phần còn lại của từng ví dương.
  const sweeps: MonthCloseSweep[] = [];
  for (const p of positives) {
    const rest = p.row.monthEndBalance - p.row.contributed;
    p.row.toWealth = Math.floor((rest * wealthPct) / 100);
    p.row.toReward = rest - p.row.toWealth;
    if (p.row.toWealth > 0) sweeps.push({ fromWalletId: p.row.walletId, toWalletId: input.wealthWalletId, kind: "wealth", amount: p.row.toWealth });
    if (p.row.toReward > 0) sweeps.push({ fromWalletId: p.row.walletId, toWalletId: rewardWalletId!, kind: "reward", amount: p.row.toReward });
  }

  const participants = rows.map((r) => r.row).filter((r) => r.monthEndBalance !== 0);
  return {
    participants,
    positiveTotal,
    holeTotal,
    covered,
    profit: positiveTotal - covered,
    toWealth: participants.reduce((s, r) => s + r.toWealth, 0),
    toReward: participants.reduce((s, r) => s + r.toReward, 0),
    covers,
    sweeps,
  };
}

/** Tháng liền trước của `YYYY-MM`. */
export function previousMonth(month: string): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

/** Tháng liền sau của `YYYY-MM`. */
export function nextMonth(month: string): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}

/** Thời điểm cuối cùng của tháng theo giờ VN, dạng ISO UTC — bút toán chốt tháng thuộc về chính tháng đó. */
export function endOfMonthIso(month: string): string {
  const [y, m] = month.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 1) - 7 * 3600_000 - 1000).toISOString();
}
