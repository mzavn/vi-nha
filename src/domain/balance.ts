// Bảng cân đối của nhà (BR-15, change 261008-bang-can-doi — Công thức 1–7, 17). Hàm thuần: nhận dữ liệu thô đã gộp
// theo tháng (một câu SQL mỗi nguồn — ADR nháp B) và dựng bảng tại một ngày D. Lịch sử theo tháng gọi cùng hàm cho từng
// cuối tháng, nên một điểm lịch sử luôn bằng đúng bảng của ngày đó. Tiền là số nguyên đồng.

import { interestGroup, yearlyInterest, type InterestGroup } from "./interest";

export type Section = "A1" | "A2" | "A3" | "A4" | "A5" | "B1" | "B2" | "B3" | "B4" | "B5" | "B6";
export type ItemSection = Exclude<Section, "A3">;
export type PyramidTier = "speculative" | "growth" | "income" | "protective" | "fixed";
export type Term = "short" | "long";
export type AssetKind = "gold" | "stock" | "fund" | "re";

export const SECTIONS: readonly Section[] = ["A1", "A2", "A3", "A4", "A5", "B1", "B2", "B3", "B4", "B5", "B6"];
export const ITEM_SECTIONS: readonly ItemSection[] = ["A1", "A2", "A4", "A5", "B1", "B2", "B3", "B4", "B5", "B6"];
export const PYRAMID: readonly PyramidTier[] = ["speculative", "growth", "income", "protective", "fixed"];
export const ASSET_KINDS: readonly AssetKind[] = ["gold", "stock", "fund", "re"];

/** Phần trăm một chữ số lẻ, cắt về 0 (`trunc(1000 × x ÷ y) ÷ 10`); mẫu số ≤ 0 → null ("—"). */
export const pct = (x: number, y: number): number | null => (y > 0 ? Math.trunc((1000 * x) / y) / 10 : null);

/** Số ngày giữa hai ngày 'YYYY-MM-DD'. */
export const daysBetween = (from: string, to: string): number => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/** Ngày cuối của tháng 'YYYY-MM'. */
export const monthEnd = (month: string): string => {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y!, m!, 0)).toISOString().slice(0, 10);
};

// ── Dữ liệu thô ─────────────────────────────────────────────────────

/** Tổng có dấu của một nguồn theo (đối tượng, tháng giờ VN). */
export interface Bucket {
  id: string;
  month: string;
  delta: number;
}
export interface AccountSrc {
  id: string;
  name: string;
  kind: string;
  openingBalance: number;
  openedAt: string | null;
  active: boolean;
  deactivatedAt: string | null;
}
export interface DebtSrc {
  id: string;
  name: string;
  active: boolean;
  deactivatedAt: string | null;
  rateBps: number;
  term: Term;
  dueDay: number | null;
}
export interface ReceivableSrc {
  id: string;
  name: string;
  active: boolean;
  deactivatedAt: string | null;
  term: Term;
}
export interface ItemSrc {
  id: string;
  name: string;
  section: ItemSection;
  pyramid: PyramidTier;
  measure: "value" | "units";
  unit: string | null;
  liquid: boolean;
  investable: boolean;
  assetKind: AssetKind | null;
  costBasis: number | null;
  acquiredOn: string | null;
  takeProfitValue: number | null;
  stopLossValue: number | null;
  note: string | null;
  sort: number;
  createdAt: string;
}
export interface ValueSrc {
  id: number;
  itemId: string;
  asOf: string;
  value: number | null;
  unitPrice: number | null;
  cashflow: number;
  cashflowPeriod: "month" | "year" | null;
  expectedReturnBps: number | null;
  createdAt: string;
}
export interface LotSrc {
  id: number;
  itemId: string;
  boughtOn: string;
  quantityMilli: number;
  unitCost: number;
  soldOn: string | null;
  soldUnitPrice: number | null;
  takeProfitPrice: number | null;
  stopLossPrice: number | null;
  note: string | null;
  createdAt: string;
}
export interface Sources {
  accounts: AccountSrc[];
  accountTx: Bucket[];
  debts: DebtSrc[];
  debtTx: Bucket[];
  receivables: ReceivableSrc[];
  receivableTx: Bucket[];
  /** Người thuê đang ở (tắt thì không có mặt ở tháng nào — như hôm nay). */
  tenantTx: Bucket[];
  /** `buy_asset` theo `asset_kind` (id = loại). */
  appAssets: Bucket[];
  items: ItemSrc[];
  values: ValueSrc[];
  lots: LotSrc[];
  highInterestBps: number;
  inflationBps: number;
}

// ── Kết quả ─────────────────────────────────────────────────────────

export interface Position {
  pnl: number;
  pnlPct: number | null;
  toTakeProfitPct: number | null;
  toStopLossPct: number | null;
  status: "take_profit" | "stop_loss" | "holding";
  heldDays: number | null;
  cagrPct: number | null;
  cagrVsExpected: number | null;
}
export interface LotView extends LotSrc {
  held: boolean;
  value: number;
  cost: number;
  realized: number | null;
  position: Position | null;
}
export interface ItemView extends ItemSrc {
  present: boolean;
  value: number | null;
  unitPrice: number | null;
  priceOn: string | null;
  cashflow: number;
  cashflowPeriod: "month" | "year" | null;
  cashflowMonthly: number | null;
  expectedReturnBps: number | null;
  heldQuantityMilli: number;
  cost: number;
  position: Position | null;
  unrealized: number | null;
  unrealizedPct: number | null;
  hitTakeProfit: number;
  hitStopLoss: number;
  lots: LotView[];
  values: ValueSrc[];
}
export interface AssetRow {
  key: string;
  source: "ledger" | "item";
  itemId: string | null;
  name: string;
  section: Section;
  pyramid: PyramidTier;
  liquid: boolean;
  investable: boolean;
  value: number;
  pctOfTotal: number | null;
  pctOfEquity: number | null;
  cashflowMonthly: number | null;
  expectedReturnBps: number | null;
  valuedOn: string | null;
}
export interface LiabilityRow {
  key: string;
  kind: "debt" | "credit_card" | "tenant_prepaid";
  refId: string | null;
  name: string;
  term: Term;
  group: InterestGroup;
  value: number;
  interestRateBps: number;
  interestPerYear: number;
  interestThisMonth: number;
  dueDay: number | null;
  pctOfTotal: number | null;
  pctOfEquity: number | null;
}
export interface Sheet {
  date: string;
  totalAssets: number;
  totalLiabilities: number;
  equity: number;
  interestPerYear: number;
  cashflowMonthly: number;
  netCashflowMonthly: number;
  assets: { section: Section; total: number; rows: AssetRow[] }[];
  liabilities: { term: Term; group: InterestGroup; total: number; rows: LiabilityRow[] }[];
  pyramid: { tier: PyramidTier; total: number; pct: number | null }[];
  items: ItemView[];
}

// ── Khoản đầu tư (Công thức 17) ─────────────────────────────────────

/**
 * Lãi / lỗ, khoảng cách tới chốt lời / cắt lỗ, trạng thái, CAGR. `p`, `c` cùng đơn vị (một đơn vị của lô, hoặc cả mục);
 * `pnl` đã tính sẵn theo số lượng. CAGR chỉ khi giữ ≥ 365 ngày, c > 0, p > 0.
 */
export function position(a: {
  p: number;
  c: number;
  pnl: number;
  takeProfit: number | null;
  stopLoss: number | null;
  boughtOn: string | null;
  today: string;
  expectedReturnBps: number | null;
}): Position {
  const { p, c } = a;
  const priced = c > 0 && p > 0;
  const heldDays = a.boughtOn ? daysBetween(a.boughtOn, a.today) : null;
  const cagr = priced && heldDays !== null && heldDays >= 365 ? (Math.pow(p / c, 365 / heldDays) - 1) * 100 : null;
  return {
    pnl: a.pnl,
    pnlPct: priced ? pct(p - c, c) : null,
    toTakeProfitPct: a.takeProfit !== null && p > 0 ? pct(a.takeProfit - p, p) : null,
    toStopLossPct: a.stopLoss !== null && p > 0 ? pct(p - a.stopLoss, p) : null,
    status: a.takeProfit !== null && p >= a.takeProfit ? "take_profit" : a.stopLoss !== null && p <= a.stopLoss ? "stop_loss" : "holding",
    heldDays,
    cagrPct: cagr === null ? null : Math.trunc(cagr * 10) / 10,
    cagrVsExpected: cagr === null || a.expectedReturnBps === null ? null : Math.trunc((cagr - a.expectedReturnBps / 100) * 10) / 10,
  };
}

/** Dòng định giá mới nhất có `as_of ≤ D` (cùng ngày: id lớn nhất). */
function latestValue(values: ValueSrc[], date: string): ValueSrc | null {
  let best: ValueSrc | null = null;
  for (const v of values) {
    if (v.asOf > date) continue;
    if (!best || v.asOf > best.asOf || (v.asOf === best.asOf && v.id > best.id)) best = v;
  }
  return best;
}

const monthlyCashflow = (v: ValueSrc | null): number | null =>
  !v || v.cashflow <= 0 ? null : v.cashflowPeriod === "year" ? Math.floor(v.cashflow / 12) : v.cashflow;

/** Một mục tại ngày D (Công thức 1, 2, 17). */
export function itemAt(item: ItemSrc, allValues: ValueSrc[], allLots: LotSrc[], date: string): ItemView {
  const values = allValues.filter((v) => v.itemId === item.id && v.asOf <= date).sort((a, b) => (b.asOf === a.asOf ? b.id - a.id : b.asOf < a.asOf ? -1 : 1));
  const latest = latestValue(values, date);
  const expectedReturnBps = latest?.expectedReturnBps ?? null;
  const base = {
    ...item,
    cashflow: latest?.cashflow ?? 0,
    cashflowPeriod: latest?.cashflowPeriod ?? null,
    cashflowMonthly: monthlyCashflow(latest),
    expectedReturnBps,
    values,
  };
  if (item.measure === "value") {
    const value = latest?.value ?? null;
    const position_ =
      value !== null && item.costBasis !== null
        ? position({
            p: value,
            c: item.costBasis,
            pnl: value - item.costBasis,
            takeProfit: item.takeProfitValue,
            stopLoss: item.stopLossValue,
            boughtOn: item.acquiredOn,
            today: date,
            expectedReturnBps,
          })
        : null;
    return {
      ...base,
      present: value !== null,
      value,
      unitPrice: null,
      priceOn: latest?.asOf ?? null,
      heldQuantityMilli: 0,
      cost: item.costBasis ?? 0,
      position: position_,
      unrealized: position_?.pnl ?? null,
      unrealizedPct: position_?.pnlPct ?? null,
      hitTakeProfit: position_?.status === "take_profit" ? 1 : 0,
      hitStopLoss: position_?.status === "stop_loss" ? 1 : 0,
      lots: [],
    };
  }
  const price = latest?.unitPrice ?? null;
  const lots = allLots
    .filter((l) => l.itemId === item.id && l.boughtOn <= date)
    .map((l): LotView => {
      const held = l.soldOn === null || l.soldOn > date;
      const p = price ?? l.unitCost;
      const cost = Math.floor((l.quantityMilli * l.unitCost) / 1000);
      return {
        ...l,
        held,
        value: held ? Math.floor((l.quantityMilli * p) / 1000) : 0,
        cost,
        realized: held ? null : Math.floor((l.quantityMilli * (l.soldUnitPrice! - l.unitCost)) / 1000),
        position: held
          ? position({
              p,
              c: l.unitCost,
              pnl: Math.floor((l.quantityMilli * (p - l.unitCost)) / 1000),
              takeProfit: l.takeProfitPrice,
              stopLoss: l.stopLossPrice,
              boughtOn: l.boughtOn,
              today: date,
              expectedReturnBps,
            })
          : null,
      };
    })
    .sort((a, b) => Number(b.held) - Number(a.held) || (a.boughtOn < b.boughtOn ? -1 : a.boughtOn > b.boughtOn ? 1 : a.id - b.id));
  const heldLots = lots.filter((l) => l.held);
  const cost = heldLots.reduce((s, l) => s + l.cost, 0);
  const unrealized = heldLots.reduce((s, l) => s + l.position!.pnl, 0);
  return {
    ...base,
    present: heldLots.length > 0,
    value: heldLots.length > 0 ? heldLots.reduce((s, l) => s + l.value, 0) : null,
    unitPrice: price,
    priceOn: price === null ? null : latest!.asOf,
    heldQuantityMilli: heldLots.reduce((s, l) => s + l.quantityMilli, 0),
    cost,
    position: null,
    unrealized: heldLots.length > 0 ? unrealized : null,
    unrealizedPct: heldLots.length > 0 ? pct(unrealized, cost) : null,
    hitTakeProfit: heldLots.filter((l) => l.position!.status === "take_profit").length,
    hitStopLoss: heldLots.filter((l) => l.position!.status === "stop_loss").length,
    lots,
  };
}

// ── Bảng tại ngày D ─────────────────────────────────────────────────

/** Có mặt tại D (Công thức 3): đang bật, hoặc đã tắt sau D. Tắt không rõ ngày (trước v1.31) → không có mặt ngày nào. */
const presentAt = (o: { active: boolean; deactivatedAt: string | null }, date: string) => o.active || (o.deactivatedAt !== null && o.deactivatedAt > date);

/** Σ bucket theo id với tháng ≤ tháng của D. */
function cumulative(buckets: Bucket[], date: string): Map<string, number> {
  const month = date.slice(0, 7);
  const out = new Map<string, number>();
  for (const b of buckets) if (b.month <= month) out.set(b.id, (out.get(b.id) ?? 0) + b.delta);
  return out;
}

const APP_ASSET: Record<AssetKind, { name: string; section: Section; pyramid: PyramidTier }> = {
  gold: { name: "Vàng mua qua app (giá mua)", section: "A1", pyramid: "protective" },
  stock: { name: "Chứng khoán mua qua app (giá mua)", section: "A2", pyramid: "growth" },
  fund: { name: "Chứng chỉ quỹ mua qua app (giá mua)", section: "A2", pyramid: "growth" },
  re: { name: "Bất động sản mua qua app (giá mua)", section: "B3", pyramid: "growth" },
};

const GROUPS: { term: Term; group: InterestGroup }[] = (["short", "long"] as const).flatMap((term) =>
  (["none", "normal", "high"] as const).map((group) => ({ term, group })),
);

/**
 * Bảng cân đối tại cuối ngày `date` (Công thức 1–7). `interestThisMonth`: lãi dự kiến tháng của ngày đó theo khoản nợ
 * (Công thức 18, câu riêng — chỉ bảng một ngày cần; lịch sử truyền {}). Dữ liệu nguồn phải đã lọc tới ≤ `date`
 * hoặc `date` là cuối tháng.
 */
export function sheetAt(src: Sources, date: string, interestThisMonth: Record<string, number> = {}): Sheet {
  type Draft = Omit<AssetRow, "pctOfTotal" | "pctOfEquity">;
  const assetRows: Draft[] = [];
  const liabilityRows: Omit<LiabilityRow, "pctOfTotal" | "pctOfEquity">[] = [];
  const ledgerRow = (key: string, name: string, section: Section, pyramid: PyramidTier, value: number, liquid = false, investable = false) => {
    if (value !== 0) assetRows.push({ key, source: "ledger", itemId: null, name, section, pyramid, liquid, investable, value, cashflowMonthly: null, expectedReturnBps: null, valuedOn: null });
  };

  // Tiền trong app; thẻ tín dụng âm sang nợ ngắn hạn (ADR nháp I).
  const accountTx = cumulative(src.accountTx, date);
  let cash = 0;
  for (const a of src.accounts) {
    if (!presentAt(a, date) || (a.openedAt !== null && a.openedAt > date)) continue;
    const balance = a.openingBalance + (accountTx.get(a.id) ?? 0);
    if (a.kind === "credit" && balance < 0) {
      liabilityRows.push({ key: `card:${a.id}`, kind: "credit_card", refId: a.id, name: a.name, term: "short", group: "none", value: -balance, interestRateBps: 0, interestPerYear: 0, interestThisMonth: 0, dueDay: null });
    } else cash += balance;
  }
  ledgerRow("cash", "Tiền trong app", "A1", "protective", cash, true, true);

  // Phải thu theo kỳ hạn; người thuê còn nợ / trả trước.
  const receivableTx = cumulative(src.receivableTx, date);
  const receivable = { short: 0, long: 0 };
  for (const r of src.receivables) if (presentAt(r, date)) receivable[r.term] += Math.max(0, receivableTx.get(r.id) ?? 0);
  ledgerRow("receivables:short", "Phải thu ngắn hạn", "A3", "protective", receivable.short);
  ledgerRow("receivables:long", "Phải thu dài hạn", "B1", "protective", receivable.long);
  let tenantsOwed = 0;
  let tenantsPrepaid = 0;
  for (const balance of cumulative(src.tenantTx, date).values()) {
    if (balance > 0) tenantsOwed += balance;
    else tenantsPrepaid -= balance;
  }
  ledgerRow("tenants", "Người thuê còn nợ", "A3", "protective", tenantsOwed);

  // Tài sản mua qua app chưa gắn mục (ADR nháp A).
  const linked = new Set(src.items.map((i) => i.assetKind).filter(Boolean));
  const appAssets = cumulative(src.appAssets, date);
  for (const kind of ASSET_KINDS) {
    if (linked.has(kind)) continue;
    const a = APP_ASSET[kind];
    ledgerRow(`app:${kind}`, a.name, a.section, a.pyramid, appAssets.get(kind) ?? 0, false, true);
  }

  // Mục nhập tay.
  const items = src.items.map((i) => itemAt(i, src.values, src.lots, date));
  let cashflowMonthly = 0;
  let netCashflowMonthly = 0;
  for (const i of items) {
    if (!i.present) continue;
    if (i.value !== 0) {
      assetRows.push({
        key: `item:${i.id}`,
        source: "item",
        itemId: i.id,
        name: i.name,
        section: i.section,
        pyramid: i.pyramid,
        liquid: i.liquid,
        investable: i.investable,
        value: i.value!,
        cashflowMonthly: i.cashflowMonthly,
        expectedReturnBps: i.expectedReturnBps,
        valuedOn: i.priceOn,
      });
    }
    if (i.cashflowMonthly !== null) {
      cashflowMonthly += i.cashflowMonthly;
      netCashflowMonthly += Math.max(0, i.cashflowMonthly - Math.ceil((i.value! * src.inflationBps) / 120_000));
    }
  }

  // Nợ từ sổ nợ.
  const debtTx = cumulative(src.debtTx, date);
  for (const d of src.debts) {
    if (!presentAt(d, date)) continue;
    const value = Math.max(0, debtTx.get(d.id) ?? 0);
    if (value === 0) continue;
    liabilityRows.push({
      key: `debt:${d.id}`,
      kind: "debt",
      refId: d.id,
      name: d.name,
      term: d.term,
      group: interestGroup(d.rateBps, src.highInterestBps),
      value,
      interestRateBps: d.rateBps,
      interestPerYear: yearlyInterest(value, d.rateBps),
      interestThisMonth: interestThisMonth[d.id] ?? 0,
      dueDay: d.dueDay,
    });
  }
  if (tenantsPrepaid > 0) {
    liabilityRows.push({ key: "tenants-prepaid", kind: "tenant_prepaid", refId: null, name: "Người thuê trả trước", term: "short", group: "none", value: tenantsPrepaid, interestRateBps: 0, interestPerYear: 0, interestThisMonth: 0, dueDay: null });
  }

  const totalAssets = assetRows.reduce((s, r) => s + r.value, 0);
  const totalLiabilities = liabilityRows.reduce((s, r) => s + r.value, 0);
  const equity = totalAssets - totalLiabilities;
  const shares = <T extends { value: number }>(r: T) => ({ ...r, pctOfTotal: pct(r.value, totalAssets), pctOfEquity: pct(r.value, equity) });
  const order = (r: Draft) => (r.source === "ledger" ? -1 : items.findIndex((i) => i.id === r.itemId));
  return {
    date,
    totalAssets,
    totalLiabilities,
    equity,
    interestPerYear: liabilityRows.reduce((s, r) => s + r.interestPerYear, 0),
    cashflowMonthly,
    netCashflowMonthly,
    assets: SECTIONS.map((section) => {
      const rows = assetRows.filter((r) => r.section === section).sort((a, b) => order(a) - order(b)).map(shares);
      return { section, total: rows.reduce((s, r) => s + r.value, 0), rows };
    }).filter((s) => s.rows.length > 0),
    liabilities: GROUPS.map(({ term, group }) => {
      const rows = liabilityRows.filter((r) => r.term === term && r.group === group).map(shares);
      return { term, group, total: rows.reduce((s, r) => s + r.value, 0), rows };
    }).filter((g) => g.rows.length > 0),
    pyramid: PYRAMID.map((tier) => {
      const total = assetRows.filter((r) => r.pyramid === tier).reduce((s, r) => s + r.value, 0);
      return { tier, total, pct: pct(total, totalAssets) };
    }),
    items,
  };
}

/** Tháng đầu tiên có dữ liệu (để lịch sử bỏ các tháng trống phía trước); không có → null. */
export function firstDataMonth(src: Sources): string | null {
  const months = [
    ...src.accountTx, ...src.debtTx, ...src.receivableTx, ...src.tenantTx, ...src.appAssets,
  ].map((b) => b.month);
  for (const a of src.accounts) if (a.openedAt) months.push(a.openedAt.slice(0, 7));
  for (const v of src.values) months.push(v.asOf.slice(0, 7));
  for (const l of src.lots) months.push(l.boughtOn.slice(0, 7));
  return months.length ? months.reduce((a, b) => (b < a ? b : a)) : null;
}

/** Các tháng 'YYYY-MM' kết thúc ở `lastMonth`, đếm lùi `count` tháng (cũ trước). */
export function monthsBack(lastMonth: string, count: number): string[] {
  const [y, m] = lastMonth.split("-").map(Number);
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(Date.UTC(y!, m! - 1 - (count - 1 - i), 1));
    return d.toISOString().slice(0, 7);
  });
}
