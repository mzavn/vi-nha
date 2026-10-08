// Chia một khoản thu nhập vào các ví. Hàm THUẦN: không đọc DB, không ghi gì, không sinh số ngẫu nhiên.
//
// Thứ tự ưu tiên engine thực thi (docs/core_design_rules.md §4):
//   Tích sản % → Thuế % → sàn Must → Must đủ dự kiến → Hưởng thụ → Có-thì-tốt (phần dư)
// Đọc ngược lại chính là thứ tự bóp khi thiếu tiền; Tích sản không bao giờ bị chạm.

import { mondaysInMonth, monthKey, monthsLeft } from "./period";

export type Tier = "wealth_building" | "tax" | "nice" | "must";
export type AllocationMode = "flat" | "percent" | "goal" | "lump" | "remainder";

/** Một dòng `allocations` đang active, ghép với ví của nó. */
export interface WalletRule {
  walletId: string;
  tier: Tier;
  mustGroup: "must" | "have" | null;
  kind: "envelope" | "accrual" | "bill" | "holding";
  mode: AllocationMode;
  period: "week" | "month" | null;
  amount: number | null;
  percent: number | null;
  targetAmount: number | null;
  targetDate: string | null;
  floorAmount: number | null;
  priority: number;
  /** Phong bì tháng chia đều theo tuần (chỉ có nghĩa với envelope flat/lump theo tháng). */
  splitWeekly?: boolean;
}

export interface AllocationInput {
  income: { amount: number; taxable: boolean; at: string };
  rules: WalletRule[];
  /** Tổng `fund` đã nạp vào từng ví trong tháng của khoản thu này. */
  fundedThisMonth: Record<string, number>;
  /** Số dư hiện tại — cần cho ví goal. */
  balances: Record<string, number>;
  /** Số dư lúc đầu tháng — ví phong bì âm từ tháng trước sẽ được bù. */
  openingBalances: Record<string, number>;
  /**
   * Nguồn thu của khoản này. Không có = luật percent toàn cục của Tích sản/Thuế như cũ.
   * Có = phần khóa chỉ lấy theo `locks` của nguồn (không trích thuế), phần còn lại chạy dòng thác.
   */
  stream?: { locks: { walletId: string; percent: number }[] } | null;
}

export interface Fund {
  walletId: string;
  amount: number;
}

export interface AllocationResult {
  funds: Fund[];
  /** Ví Must nhận chưa tới sàn — vẫn ghi để lộ sự thật, không vay phần đã khóa. */
  underfunded: string[];
  /** Phần đã nạp thêm để bù hố âm tháng trước, theo ví — giao diện phải nói ra. */
  deficitCovered: Record<string, number>;
}

export class AllocationConfigError extends Error {}

interface Want {
  walletId: string;
  priority: number;
  amount: number;
}

/** Rót `pool` cho các nhu cầu theo priority tăng dần; cùng priority thì chia theo tỷ lệ, đồng lẻ dồn về ví đầu nhóm. */
function pour(pool: number, wants: Want[], into: Map<string, number>): number {
  const priorities = [...new Set(wants.map((w) => w.priority))].sort((a, b) => a - b);
  for (const priority of priorities) {
    const group = wants.filter((w) => w.priority === priority && w.amount > 0);
    const need = group.reduce((sum, w) => sum + w.amount, 0);
    if (need === 0) continue;
    if (need <= pool) {
      for (const w of group) into.set(w.walletId, (into.get(w.walletId) ?? 0) + w.amount);
      pool -= need;
      continue;
    }
    let given = 0;
    for (const w of group) {
      const share = Math.floor((pool * w.amount) / need);
      into.set(w.walletId, (into.get(w.walletId) ?? 0) + share);
      given += share;
    }
    const first = group[0]!;
    into.set(first.walletId, (into.get(first.walletId) ?? 0) + (pool - given));
    return 0;
  }
  return pool;
}

export function allocate(input: AllocationInput): AllocationResult {
  const { income, rules, fundedThisMonth, balances, openingBalances } = input;
  if (!Number.isInteger(income.amount) || income.amount <= 0) {
    throw new AllocationConfigError("Số tiền thu nhập phải là số nguyên dương (VND).");
  }
  const remainders = rules.filter((r) => r.mode === "remainder");
  if (remainders.length !== 1) {
    throw new AllocationConfigError(`Cần đúng một ví nhận phần còn lại, đang có ${remainders.length}.`);
  }
  const remainder = remainders[0]!;

  const weeks = mondaysInMonth(monthKey(income.at));
  const perMonth = (r: WalletRule, value: number | null) => (value ?? 0) * (r.period === "week" ? weeks : 1);
  const funded = (id: string) => fundedThisMonth[id] ?? 0;
  // Chỉ phong bì mới "tiêu lố"; ví tích dồn âm là lỗi dữ liệu, không tự bù.
  const deficit = (r: WalletRule) => (r.kind === "envelope" ? Math.max(0, -(openingBalances[r.walletId] ?? 0)) : 0);

  /** Nhu cầu của cả tháng, chưa trừ phần đã nạp và chưa cộng hố âm. */
  const monthlyNeed = (r: WalletRule): number => {
    switch (r.mode) {
      case "flat":
        return perMonth(r, r.amount);
      case "lump":
        return r.amount ?? r.targetAmount ?? 0;
      case "goal": {
        // Lấy số dư trước các lần nạp của tháng này làm gốc, để khoản thu thứ hai không tính lại nhu cầu.
        const base = (balances[r.walletId] ?? 0) - funded(r.walletId);
        const missing = Math.max(0, (r.targetAmount ?? 0) - base);
        return Math.ceil(missing / monthsLeft(income.at, r.targetDate!));
      }
      default:
        return 0;
    }
  };
  const stillNeeded = (r: WalletRule, base: number) => Math.max(0, base + deficit(r) - funded(r.walletId));

  const out = new Map<string, number>();
  let pool = income.amount;

  // 1–2. Phần khóa: phần trăm của CHÍNH khoản thu, không phụ thuộc nhu cầu.
  if (input.stream) {
    // Theo nguồn thu: chỉ khóa theo hồ sơ của nguồn, không trích thuế theo luật toàn cục.
    const locks = input.stream.locks;
    for (const lock of locks) {
      const cut = Math.floor(income.amount * lock.percent);
      out.set(lock.walletId, (out.get(lock.walletId) ?? 0) + cut);
      pool -= cut;
    }
    if (pool < 0) throw new AllocationConfigError("Tổng phần khóa của nguồn thu vượt 100%.");
    if (locks.length > 0 && Math.abs(locks.reduce((s, l) => s + l.percent, 0) - 1) < 1e-9) {
      // Khóa trọn 100%: đồng lẻ do làm tròn về ví khóa đầu tiên; không chạy dòng thác, không cờ thiếu sàn.
      out.set(locks[0]!.walletId, out.get(locks[0]!.walletId)! + pool);
      const funds = [...out].filter(([, amount]) => amount > 0).map(([walletId, amount]) => ({ walletId, amount }));
      return { funds, underfunded: [], deficitCovered: {} };
    }
  } else {
    for (const r of rules) {
      if (r.mode !== "percent" || (r.tier !== "wealth_building" && r.tier !== "tax")) continue;
      if (r.tier === "tax" && !income.taxable) continue;
      const cut = Math.floor(income.amount * (r.percent ?? 0));
      out.set(r.walletId, (out.get(r.walletId) ?? 0) + cut);
      pool -= cut;
    }
    if (pool < 0) throw new AllocationConfigError("Tổng phần trăm Tích sản + Thuế vượt 100% thu nhập.");
  }

  const musts = rules.filter((r) => r.tier === "must" && r.mustGroup === "must" && r.mode !== "remainder" && r.mode !== "percent");
  const floorOf = (r: WalletRule) => Math.min(perMonth(r, r.floorAmount), monthlyNeed(r));

  // 3. Sàn Must.
  pool = pour(pool, musts.map((r) => ({ walletId: r.walletId, priority: r.priority, amount: stillNeeded(r, floorOf(r)) })), out);
  // 4. Must đủ dự kiến: phần còn thiếu sau khi đã tính cả tiền vừa rót ở bước 3.
  pool = pour(
    pool,
    musts.map((r) => ({
      walletId: r.walletId,
      priority: r.priority,
      amount: Math.max(0, stillNeeded(r, monthlyNeed(r)) - (out.get(r.walletId) ?? 0)),
    })),
    out,
  );

  // 5. Hưởng thụ, rồi các ví nhóm Have có dự kiến riêng (hiếm) — bị bóp trước Must, sau phần dư.
  const flexible = (group: WalletRule[]) =>
    group.map((r) => ({
      walletId: r.walletId,
      priority: r.priority,
      amount: r.mode === "percent" ? Math.floor(income.amount * (r.percent ?? 0)) : stillNeeded(r, monthlyNeed(r)),
    }));
  pool = pour(pool, flexible(rules.filter((r) => r.tier === "nice")), out);
  pool = pour(pool, flexible(rules.filter((r) => r.tier === "must" && r.mustGroup === "have" && r.mode !== "remainder")), out);

  // 6. Phần còn lại — có thể 0, không bao giờ âm.
  if (pool > 0) out.set(remainder.walletId, (out.get(remainder.walletId) ?? 0) + pool);

  const underfunded = musts
    .filter((r) => floorOf(r) > 0 && funded(r.walletId) + (out.get(r.walletId) ?? 0) < floorOf(r) + deficit(r))
    .map((r) => r.walletId);

  // Hố được lấp trước tiên bởi tiền nạp trong tháng; phần do LẦN CHIA NÀY lấp = chênh lệch trước/sau.
  const deficitCovered: Record<string, number> = {};
  for (const r of rules) {
    const hole = deficit(r);
    if (hole === 0) continue;
    const covered = Math.min(hole, funded(r.walletId) + (out.get(r.walletId) ?? 0)) - Math.min(hole, funded(r.walletId));
    if (covered > 0) deficitCovered[r.walletId] = covered;
  }

  const funds = [...out].filter(([, amount]) => amount > 0).map(([walletId, amount]) => ({ walletId, amount }));
  const total = funds.reduce((sum, f) => sum + f.amount, 0);
  if (total !== income.amount) throw new Error(`Bất biến vỡ: chia ${total} ≠ thu nhập ${income.amount}.`);
  return { funds, underfunded, deficitCovered };
}
