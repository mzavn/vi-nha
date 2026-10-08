// "Tiền chi được" ở Hôm nay (ADR-85, ADR-88): dựng các dòng của card từ `snapshot.spendableCash`. Thuần để test.
// Server đã tính số; ở đây chỉ chọn dòng nào hiện, chữ gì, và gắn cảnh báo lệch đối soát đã có sẵn trong snapshot.

import type { SpendableCash } from "../../../src/domain/snapshot";
import { driftOf } from "./drift";
import { formatVnd } from "./money";
import type { Snapshot } from "./types";

export interface CashLine {
  key: string;
  label: string;
  value: number;
  /** Dòng phụ: tài khoản đang lệch đối soát (cùng luật `driftOf` với banner). */
  note: string | null;
}

export interface CashView {
  /** Luôn ≥ 0; `short` = tiền ở các tài khoản đang tính chưa đủ giữ Tích sản và Thuế, `amount` là số thiếu. */
  amount: number;
  short: boolean;
  meta: string;
  lines: CashLine[];
  /** "Không tính: …" — null khi tài khoản nào cũng tính. */
  excluded: string | null;
}

export function spendableCashView(sc: SpendableCash, drift: Snapshot["attention"]["drift"]): CashView {
  const drifted = new Set(drift.filter((d) => driftOf(d) !== null).map((d) => d.accountId));
  const lines: CashLine[] = sc.accounts.map((a) => ({
    key: `acc:${a.accountId}`,
    label: a.name,
    value: a.balance,
    note: drifted.has(a.accountId) ? "sổ lệch — xem Đối soát" : null,
  }));
  if (sc.wealthBuildingHeld !== 0) {
    const label = sc.wealthBuildingOutside > 0 ? "Trừ Tích sản đang giữ (phần chưa nằm ở heo / phao / sổ tiết kiệm)" : "Trừ Tích sản đang giữ";
    lines.push({ key: "wealthBuilding", label, value: -sc.wealthBuildingHeld, note: null });
  }
  if (sc.taxHeld !== 0) lines.push({ key: "tax", label: "Trừ Thuế đang giữ", value: -sc.taxHeld, note: null });

  // Heo đất gộp một tên; tài khoản khác theo tên. Phần Tích sản nằm ở đó thì nói luôn để biết vì sao không bị trừ lại (ADR-88).
  const names = [...sc.excluded.filter((a) => a.role !== "piggy_bank").map((a) => a.name), ...(sc.excluded.some((a) => a.role === "piggy_bank") ? ["heo đất"] : [])];
  const outside = sc.wealthBuildingOutside > 0 ? ` — trong đó ${formatVnd(sc.wealthBuildingOutside)} là Tích sản, không trừ lại` : "";

  const short = sc.amount < 0;
  return {
    amount: Math.abs(sc.amount),
    short,
    meta: short
      ? `Tiền trong các tài khoản đang tính chưa đủ giữ Tích sản và Thuế, thiếu ${formatVnd(-sc.amount)}.`
      : "Tiền thật trong các tài khoản đang tính, trừ phần Tích sản và Thuế phải giữ.",
    lines,
    excluded: names.length > 0 ? `Không tính: ${names.join(", ")}${outside}` : null,
  };
}
