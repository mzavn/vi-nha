import { formatVnd } from "./money";
import type { AccountRow } from "./types";

/** "Tiền thật đang có" ở tab Tài khoản (pwa UC-707): Σ số trong sổ — bằng `networth.cash`; thẻ tín dụng đang nợ (âm) cộng như số âm, báo `hasCredit`. */
export function accountsTotal(rows: Pick<AccountRow, "kind" | "bookBalance">[]): { total: number; hasCredit: boolean } {
  return {
    total: rows.reduce((sum, r) => sum + r.bookBalance, 0),
    hasCredit: rows.some((r) => r.kind === "credit" && r.bookBalance < 0),
  };
}

/** Một hàng của danh sách tài khoản có lồng khoản gửi kỳ hạn: `line` (con) = "↳ {tên} · {số}"; `sub` (mẹ) = "gồm {n} khoản gửi · tổng {gộp}". */
export interface NestedAccount<T> {
  row: T;
  child: boolean;
  line: string | null;
  sub: string | null;
}

/**
 * Lồng khoản gửi kỳ hạn ngay dưới tài khoản mẹ (ADR-140; pwa UC-707 AC-39, UC-709 Cài đặt › Tài khoản), giữ thứ tự còn lại.
 * Con mà mẹ không có trong danh sách thì đứng riêng như tài khoản thường. Số tiền qua bộ định dạng có che số (UC-718).
 */
export function nestAccounts<T>(rows: T[], info: (row: T) => { id: string; name: string; balance: number; parentId: string | null }): NestedAccount<T>[] {
  const items = rows.map((row) => ({ row, ...info(row) }));
  const ids = new Set(items.map((i) => i.id));
  return items
    .filter((i) => !i.parentId || !ids.has(i.parentId))
    .flatMap((i) => {
      const kids = items.filter((k) => k.parentId === i.id);
      const total = i.balance + kids.reduce((s, k) => s + k.balance, 0);
      return [
        { row: i.row, child: false, line: null, sub: kids.length ? `gồm ${kids.length} khoản gửi · tổng ${formatVnd(total)}` : null },
        ...kids.map((k) => ({ row: k.row, child: true, line: `↳ ${k.name} · ${formatVnd(k.balance)}`, sub: null })),
      ];
    });
}
