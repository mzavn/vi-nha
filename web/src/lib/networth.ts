// Khối "tiền thật trước" ở đầu tab Nợ (GET /v1/networth): thứ tự, nhãn, dòng nào ẩn khi bằng 0.
// Thuần để test. DESIGN.md §4: số ra quyết định (tiền thật đang có) đứng đầu và to nhất; tài sản ròng nhỏ hơn, đứng cuối.

import { formatVnd } from "./money";
import type { NetWorth } from "./types";

export interface NetWorthLine {
  key: "cash" | "assets" | "balanceItems" | "owedToUs" | "receivables" | "tenants" | "weOwe" | "debts" | "tenantsPrepaid" | "netWorth";
  /** hero: số to nhất · row: một nhóm · part: chi tiết của nhóm ngay trên · total: tài sản ròng, nhỏ hơn hero. */
  level: "hero" | "row" | "part" | "total";
  label: string;
  /** Nói nhãn gồm những gì (chỉ dòng tiền thật). */
  hint?: string;
  /** Dòng phụ / nhãn nói rõ đây có phải tiền tiêu được không. */
  note: string | null;
  /** Mình nợ mang dấu âm: bị trừ khi cộng tài sản ròng. */
  value: number;
}

export function netWorthLines(nw: NetWorth): NetWorthLine[] {
  const owedToUs = nw.receivables + nw.tenants;
  const weOwe = nw.debts + nw.tenantsPrepaid;
  // Tích luỹ nằm trong tiền thật (receivable UC-1005 bước 2.1): kể tổng ngăn rồi các tài khoản ngăn Tích luỹ. Tích luỹ 0 →
  // không dòng phụ.
  const savingsTotal = nw.pockets.savings;
  const places = nw.savings.accounts.filter((a) => a.balance !== 0).map((a) => `${a.name.charAt(0).toUpperCase()}${a.name.slice(1)} ${formatVnd(a.balance)}`);
  const cashNote = savingsTotal !== 0 ? `trong đó Tích luỹ ${formatVnd(savingsTotal)}${places.length ? ` (${places.join(" · ")})` : ""}` : null;
  const lines: (NetWorthLine | false)[] = [
    { key: "cash", level: "hero", label: "Tiền thật đang có", hint: "tiền mặt và tiền trong tài khoản", note: cashNote, value: nw.cash },
    // Mua qua app chưa gắn mục (giá mua) và tài sản ngoài app (định giá ở màn Tài sản & tự do — receivable UC-1005).
    nw.assets !== 0 && { key: "assets", level: "row", label: "Tài sản mua qua app", note: "giá mua — không phải tiền mặt, bán mới thành tiền", value: nw.assets },
    !!nw.balanceItems && { key: "balanceItems", level: "row", label: "Tài sản ngoài app (vàng, đất…)", note: "giá mới nhất bạn nhập — không phải tiền mặt", value: nw.balanceItems },
    owedToUs !== 0 && { key: "owedToUs", level: "row", label: "Người khác nợ mình", note: "chưa phải tiền", value: owedToUs },
    // Chi tiết nói khoản phải thu đến từ đâu; nguồn nào bằng 0 thì ẩn.
    nw.receivables !== 0 && { key: "receivables", level: "part", label: "Cho vay / trả hộ", note: null, value: nw.receivables },
    nw.tenants !== 0 && { key: "tenants", level: "part", label: "Người thuê còn nợ", note: null, value: nw.tenants },
    weOwe !== 0 && { key: "weOwe", level: "row", label: "Mình nợ", note: null, value: -weOwe },
    // Người thuê trả trước là mình nợ dịch vụ: chỉ khi có mới tách khỏi sổ nợ.
    nw.tenantsPrepaid > 0 && nw.debts !== 0 && { key: "debts", level: "part", label: "Sổ nợ", note: null, value: -nw.debts },
    nw.tenantsPrepaid > 0 && { key: "tenantsPrepaid", level: "part", label: "Người thuê trả trước", note: null, value: -nw.tenantsPrepaid },
    {
      key: "netWorth",
      level: "total",
      label: "Vốn chủ sở hữu (tài sản ròng)",
      note: "Cộng hết lại rồi trừ nợ — khớp vốn chủ ở bảng cân đối. Con số quan trọng hằng ngày vẫn là tiền thật đang có ở trên.",
      value: nw.netWorth,
    },
  ];
  return lines.filter((l): l is NetWorthLine => l !== false);
}
