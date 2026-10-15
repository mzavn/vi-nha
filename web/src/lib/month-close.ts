// Chốt tháng ở PWA (allocation UC-207, ADR-111): thẻ Hôm nay, sheet xem trước, chọn Ví Thưởng.
// Mọi con số lấy từ server (GET /v1/month-close) — PWA không tự tính bù / chia.

import { formatVnd } from "./money";
import type { MonthCloseOpen, MonthCloseResult, MonthCloseView, Wallet } from "./types";

/** Thanh tỷ lệ Tích sản / Ví Thưởng ở sheet chốt tháng. */
export const CLOSE_PCT_STEP = 5;

export interface MonthCloseLine {
  key: string;
  label: string;
  value: number;
}

const monthNumber = (month: string) => Number(month.slice(5, 7));

export function monthClosePath(pct?: number): string {
  return pct === undefined ? "/v1/month-close" : `/v1/month-close?wealth_pct=${pct}`;
}

/** Thẻ Hôm nay: chỉ khi chưa chốt và có ví dương (cùng điều kiện câu mời ở tin sáng); không thì null. */
export function monthCloseCard(v: MonthCloseView): { title: string; line: string } | null {
  if (v.closed || v.positiveTotal <= 0) return null;
  const line =
    v.profit > 0
      ? `Dư ${formatVnd(v.profit)}${v.covered > 0 ? ` sau khi bù chi lố ${formatVnd(v.covered)}` : ""}`
      : `Chi lố được bù ${formatVnd(v.covered)}, không còn dư`;
  return { title: `Chốt tháng ${monthNumber(v.month)}`, line };
}

/** Bảng của sheet: các lần bù, các lần quét, dòng tổng, ví âm còn chưa bù hết (chờ lần chia sau). Tên ví lấy từ bản xem
 *  trước, rồi danh sách ví. */
export function monthCloseLines(
  v: MonthCloseOpen,
  wallets: Wallet[],
): { covers: MonthCloseLine[]; sweeps: MonthCloseLine[]; total: MonthCloseLine[]; left: MonthCloseLine[] } {
  const names = new Map<string, string>(wallets.map((w) => [w.id, w.name]));
  for (const p of v.participants) names.set(p.walletId, p.name);
  const name = (id: string) => names.get(id) ?? id;
  const move = (m: { fromWalletId: string; toWalletId: string; amount: number }, i: number): MonthCloseLine => ({
    key: `${i}:${m.fromWalletId}:${m.toWalletId}`,
    label: `${name(m.fromWalletId)} → ${name(m.toWalletId)}`,
    value: m.amount,
  });
  const total: MonthCloseLine[] = [
    { key: "covered", label: "Bù chi lố", value: v.covered },
    { key: "profit", label: "Lợi nhuận thêm", value: v.profit },
  ];
  if (v.profit > 0) {
    total.push({ key: "wealth", label: `Vào ${name(v.wealthWalletId)} (${v.wealthPct}%)`, value: v.toWealth });
    if (v.rewardWalletId) total.push({ key: "reward", label: `Vào ${name(v.rewardWalletId)} (${100 - v.wealthPct}%)`, value: v.toReward });
  }
  const left = v.participants
    .filter((p) => p.hole > p.coverReceived)
    .map((p): MonthCloseLine => ({ key: `left:${p.walletId}`, label: p.name, value: p.coverReceived - p.hole }));
  return { covers: v.covers.map(move), sweeps: v.sweeps.map(move), total, left };
}

/** Ví thành âm sau khi chốt muộn: đã tiêu tiền dư của tháng chốt sang tháng sau. */
export function monthCloseWarning(v: Pick<MonthCloseOpen, "month">, w: { name: string; balanceAfter: number }): string {
  const month = monthNumber(v.month);
  const next = (month % 12) + 1;
  return `Sau khi chốt, ${w.name} còn ${formatVnd(w.balanceAfter)} (đã chi tháng ${next} bằng tiền dư tháng ${month}) — sẽ bù ở lần chốt tháng ${next}`;
}

/** Toast sau khi chốt; phần nào bằng 0 thì bỏ. */
export function monthCloseToast(r: MonthCloseResult): string {
  const parts = [
    r.covered > 0 && `bù ${formatVnd(r.covered)}`,
    r.toWealth > 0 && `Tích sản +${formatVnd(r.toWealth)}`,
    r.toReward > 0 && `Ví Thưởng +${formatVnd(r.toReward)}`,
    r.transferOrders.length > 0 && `${r.transferOrders.length} lệnh chuyển`,
  ].filter((s): s is string => typeof s === "string");
  return `Đã chốt tháng ${monthNumber(r.month)}${parts.length > 0 ? `: ${parts.join(", ")}` : ""}`;
}

/** Ví chọn làm Ví Thưởng (giống server): ví chung không riêng tư, phe Must / Hưởng thụ, không phải phong bì
 *  (phong bì chung tham gia chốt; ví cá nhân không nhận phần dư của cả nhà). Chỗ gọi truyền ví đang dùng. */
export function rewardWalletOptions<W extends Pick<Wallet, "tier" | "kind" | "scope" | "private">>(wallets: W[]): W[] {
  return wallets.filter((w) => (w.tier === "must" || w.tier === "nice") && w.scope === "shared" && !w.private && w.kind !== "envelope");
}

/** Chưa có Ví Thưởng → thanh khoá ở 100%, kèm câu chỉ chỗ đặt; có thì null. */
export function closePctLock(v: MonthCloseOpen): string | null {
  return v.rewardWalletId === null ? "Chưa đặt Ví Thưởng — cả phần dư vào Tích sản. Đặt ở Cài đặt › Tham số." : null;
}

/** Bước 5; tham số mặc định không chia hết cho 5 thì bước 1 để thanh không nhảy khỏi số đã đặt. */
export function closePctStep(v: MonthCloseOpen): number {
  return v.defaultWealthPct % CLOSE_PCT_STEP === 0 ? CLOSE_PCT_STEP : 1;
}
