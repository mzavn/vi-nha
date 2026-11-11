import type { AccountRow } from "./types";

/** "Tiền thật đang có" ở tab Tài khoản (pwa UC-707): Σ số trong sổ — bằng `networth.cash`; thẻ tín dụng đang nợ (âm) cộng như số âm, báo `hasCredit`. */
export function accountsTotal(rows: Pick<AccountRow, "kind" | "bookBalance">[]): { total: number; hasCredit: boolean } {
  return {
    total: rows.reduce((sum, r) => sum + r.bookBalance, 0),
    hasCredit: rows.some((r) => r.kind === "credit" && r.bookBalance < 0),
  };
}
