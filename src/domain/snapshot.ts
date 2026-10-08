// Màn "Hôm nay", tin Telegram sáng và tool MCP `get_snapshot` đều lấy số từ đúng một hàm này.

import type { WalletRule } from "./allocation";
import { dayKey, mondaysInMonth, monthKey, weekKey, weeksLeftInMonth } from "./period";
import { isReserve, type AccountRole, type WalletRef } from "./types";

export interface SnapshotData {
  now: Date;
  viewerId: string | null;
  wallets: WalletRef[];
  rules: WalletRule[];
  balances: Record<string, number>;
  spentWeek: Record<string, number>;
  spentMonth: Record<string, number>;
  wealthBuilding: { cash: number; assets: number } | null;
  safetyFund: { cash: number; target: number | null; monthsOfData: number } | null;
  safetyFundMonths: number;
  goals: { walletId: string; name: string; target: number; balance: number; targetDate: string }[];
  pending: { count: number; net: number };
  drift: { accountId: string; name: string; bookDrift: number | null }[];
  transferOrders: { pending: number; overdue: number };
  /** Khoản thu còn hiệu lực chưa chia — tiền đang nằm ở ví Thu nhập. `oldestTxId`: khoản cũ nhất, null khi không còn. */
  unallocatedIncome: { count: number; amount: number; oldestTxId: number | null };
  /** Tài khoản đang dùng kèm số dư sổ (`v_account_book`) — cho "Tiền chi được" (ADR-85, ADR-88). */
  accounts: { id: string; name: string; role: AccountRole | null; locked: boolean; spendable: boolean; balance: number }[];
}

export interface WalletLine {
  id: string;
  name: string;
  tier: WalletRef["tier"];
  mustGroup: WalletRef["mustGroup"];
  kind: WalletRef["kind"];
  /** null = ví riêng tư của người khác: hiện tên, ẩn số. */
  balance: number | null;
  monthTarget: number | null;
  spentMonth: number | null;
  weekTarget: number | null;
  spentWeek: number | null;
}

/** Nhu cầu tháng theo luật nạp, phong bì tuần nhân số thứ Hai thật của tháng. */
export function monthTarget(rule: WalletRule | undefined, month: string): number | null {
  if (!rule) return null;
  if (rule.mode === "flat") return (rule.amount ?? 0) * (rule.period === "week" ? mondaysInMonth(month) : 1);
  if (rule.mode === "lump") return rule.amount ?? rule.targetAmount ?? null;
  return null;
}

/**
 * Dự kiến tuần: phong bì tuần, hoặc phong bì tháng có `splitWeekly` chia đều theo số thứ Hai của tháng
 * (`month` = tháng chứa ngày thứ Hai đầu tuần). Ví khác: null.
 */
export function weekTarget(rule: WalletRule | undefined, month: string): number | null {
  if (!rule) return null;
  if (rule.mode === "flat" && rule.period === "week") return rule.amount;
  if (rule.splitWeekly && rule.kind === "envelope" && (rule.mode === "flat" || rule.mode === "lump")) {
    return Math.floor((monthTarget(rule, month) ?? 0) / mondaysInMonth(month));
  }
  return null;
}

/** Monday..Sunday của tuần chứa `now`, theo giờ VN. */
function weekRange(now: Date): { start: string; end: string } {
  const today = dayKey(now);
  const d = new Date(`${today}T00:00:00Z`);
  const dow = d.getUTCDay() || 7;
  const start = new Date(d.getTime() - (dow - 1) * 86_400_000);
  const end = new Date(start.getTime() + 6 * 86_400_000);
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

/** Tiền chi được (ADR-85, ADR-88), trả ở `snapshot.spendableCash`. */
export interface SpendableCash {
  /** Σ số dư sổ tài khoản đang tính − `wealthBuildingHeld` − `taxHeld`; âm được phép. */
  amount: number;
  /** Tài khoản đang tính (không khóa, bật `spendable`), theo thứ tự server. */
  accounts: { accountId: string; name: string; balance: number }[];
  /** Tích sản tiền mặt còn nằm trong các tài khoản đang tính — phần phải trừ. */
  wealthBuildingHeld: number;
  /** Phần Tích sản đã nằm ở tài khoản Tích sản không tính (heo, phao, sổ tiết kiệm — ADR-88) — không trừ lại. */
  wealthBuildingOutside: number;
  taxHeld: number;
  /** Tài khoản đang dùng không tính (tắt công tắc, khóa, thẻ tín dụng), kèm vai trò Tích sản nếu có. */
  excluded: { accountId: string; name: string; role: AccountRole | null }[];
}

/**
 * Tiền chi được (ADR-85) = Σ số dư sổ của tài khoản đang tính (không khóa, bật `spendable`) − Tích sản đang giữ − Thuế đang giữ.
 * Tài khoản Tích sản không tính (heo đất, phao, sổ tiết kiệm — ADR-88) giữ tiền Tích sản: phần đó (`wealthBuildingOutside`, tối đa
 * bằng Tích sản) không trừ lần nữa. Tài khoản thường tắt công tắc thì sổ không biết tiền trong đó là gì: không coi là Tích sản
 * (sai về phía thấp an toàn hơn). Tích sản / Thuế âm không cộng ngược vào. Kết quả âm được phép.
 */
export function spendableCash(accounts: SnapshotData["accounts"], wealthBuildingCash: number, taxBalance: number): SpendableCash {
  const counted = accounts.filter((a) => a.spendable && !a.locked);
  const outside = Math.max(0, accounts.filter((a) => a.role && !counted.includes(a)).reduce((s, a) => s + a.balance, 0));
  const wealthBuilding = Math.max(0, wealthBuildingCash);
  const wealthBuildingOutside = Math.min(outside, wealthBuilding);
  const wealthBuildingHeld = wealthBuilding - wealthBuildingOutside;
  const taxHeld = Math.max(0, taxBalance);
  return {
    amount: counted.reduce((s, a) => s + a.balance, 0) - wealthBuildingHeld - taxHeld,
    accounts: counted.map((a) => ({ accountId: a.id, name: a.name, balance: a.balance })),
    wealthBuildingHeld,
    wealthBuildingOutside,
    taxHeld,
    excluded: accounts.filter((a) => !counted.includes(a)).map((a) => ({ accountId: a.id, name: a.name, role: a.role })),
  };
}

/**
 * Số dư có sẵn của một tài khoản vừa thành tài khoản Tích sản không tính (ADR-91): phần ghi có ví Tích sản, không lấy từ
 * ví nào. `outsideBefore` = Σ số dư sổ các tài khoản Tích sản không tính trước khi ghi (như `spendableCash`), `balance` =
 * số dư sổ của tài khoản đó. Phần Tích sản đang nằm ở tài khoản thường coi như đã chuyển vào đây, nên chỉ ghi phần làm
 * tài khoản Tích sản nhiều hơn Tích sản tiền mặt — luôn nằm gọn trong `wealthBuildingOutside`, Tiền chi được không đổi.
 */
export function openingWealthBuildingCredit(balance: number, outsideBefore: number, wealthBuildingCash: number): number {
  if (balance <= 0) return 0;
  return Math.min(balance, Math.max(0, Math.max(0, outsideBefore + balance) - Math.max(0, wealthBuildingCash)));
}

export function buildSnapshot(data: SnapshotData) {
  const { now, wallets, rules, balances, spentWeek, spentMonth } = data;
  const month = monthKey(now);
  const ruleOf = (id: string) => rules.find((r) => r.walletId === id);
  const hidden = (w: WalletRef) => w.private && w.memberId !== data.viewerId;
  const weeksLeft = weeksLeftInMonth(now);

  const weekMonth = weekRange(now).start.slice(0, 7);

  const lines: WalletLine[] = wallets.map((w) => {
    const rule = ruleOf(w.id);
    const target = weekTarget(rule, weekMonth);
    const secret = hidden(w);
    return {
      id: w.id,
      name: w.name,
      tier: w.tier,
      mustGroup: w.mustGroup,
      kind: w.kind,
      balance: secret ? null : balances[w.id] ?? 0,
      monthTarget: secret ? null : monthTarget(rule, month),
      spentMonth: secret ? null : spentMonth[w.id] ?? 0,
      weekTarget: secret ? null : target,
      spentWeek: secret || target === null ? null : spentWeek[w.id] ?? 0,
    };
  });

  // Còn để chi tuần này — chỉ các phong bì chi tiêu của phe Vận hành (Must + Có-thì-tốt).
  const spendable = lines.filter((l) => l.tier === "must" && l.kind === "envelope" && l.balance !== null);
  const perWallet = spendable.map((l) => {
    const balance = l.balance!;
    const amount =
      l.weekTarget !== null
        ? Math.min(l.weekTarget - (l.spentWeek ?? 0), balance)
        : balance <= 0
          ? balance
          : Math.floor(balance / weeksLeft);
    return { walletId: l.id, name: l.name, amount };
  });

  const sum = (xs: (number | null)[]) => xs.reduce<number>((s, x) => s + (x ?? 0), 0);
  const group = (pred: (l: WalletLine) => boolean) => {
    const ls = lines.filter(pred);
    return { balance: sum(ls.map((l) => l.balance)), monthTarget: sum(ls.map((l) => l.monthTarget)) };
  };

  // Quỹ an tâm: có đủ 3 tháng chi Must trọn thì dùng số thật; chưa đủ thì ước bằng tổng dự kiến tháng của nhóm Must.
  const mustNeed = sum(lines.filter((l) => l.tier === "must" && l.mustGroup === "must").map((l) => l.monthTarget));
  const safetyFundTarget = data.safetyFund?.target ?? mustNeed * data.safetyFundMonths;
  const safetyFundCash = data.safetyFund?.cash ?? data.wealthBuilding?.cash ?? 0;
  const monthlyBase = safetyFundTarget / Math.max(1, data.safetyFundMonths);

  return {
    at: now.toISOString(),
    day: dayKey(now),
    week: { key: weekKey(now), ...weekRange(now), weeksLeftInMonth: weeksLeft },
    month,
    spendableThisWeek: sum(perWallet.map((p) => p.amount)),
    spendableByWallet: perWallet,
    tiers: {
      wealth_building: { balance: group((l) => l.tier === "wealth_building").balance, cash: data.wealthBuilding?.cash ?? 0, assets: data.wealthBuilding?.assets ?? 0 },
      tax: { balance: group((l) => l.tier === "tax").balance },
      nice: group((l) => l.tier === "nice"),
      must: group((l) => l.tier === "must" && l.mustGroup === "must"),
      have: group((l) => l.tier === "must" && l.mustGroup === "have"),
    },
    wallets: lines,
    /** Ví quỹ giữ riêng (vd "Thu cho thuê"): không vào "còn để chi", dùng theo quyết định từng lần. */
    reserves: wallets.filter(isReserve).map((w) => ({ walletId: w.id, name: w.name, balance: hidden(w) ? null : balances[w.id] ?? 0 })),
    safetyFund: {
      cash: safetyFundCash,
      target: safetyFundTarget,
      months: data.safetyFundMonths,
      monthsCovered: monthlyBase > 0 ? Math.round((safetyFundCash / monthlyBase) * 10) / 10 : null,
      pct: safetyFundTarget > 0 ? Math.min(100, Math.round((1000 * safetyFundCash) / safetyFundTarget) / 10) : null,
      /** true = chưa đủ 3 tháng dữ liệu, mục tiêu đang ước từ ngân sách. */
      estimated: !data.safetyFund?.target,
    },
    goals: data.goals.map((g) => ({ ...g, pct: g.target > 0 ? Math.min(100, Math.round((1000 * g.balance) / g.target) / 10) : null })),
    attention: {
      pendingLogs: data.pending.count,
      pendingNet: data.pending.net,
      drift: data.drift.filter((d) => (d.bookDrift ?? 0) !== 0),
      transferOrdersPending: data.transferOrders.pending,
      transferOrdersOverdue: data.transferOrders.overdue,
      unallocatedIncome: data.unallocatedIncome,
    },
    /** Tiền chi được (ADR-85): tiền thật ở tài khoản đang tính, trừ Tích sản và Thuế còn giữ. */
    spendableCash: spendableCash(data.accounts, data.wealthBuilding?.cash ?? 0, group((l) => l.tier === "tax").balance),
  };
}

export type Snapshot = ReturnType<typeof buildSnapshot>;
