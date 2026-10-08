// Khối "tiền thật trước" ở đầu tab Nợ (GET /v1/networth): thứ tự, nhãn, dòng nào ẩn khi bằng 0.
// Thuần để test. DESIGN.md §4: số ra quyết định (tiền thật đang có) đứng đầu và to nhất; tài sản ròng nhỏ hơn, đứng cuối.

import { formatVnd } from "./money";
import { wealthBuildingAccountLabel } from "./wealth-building-accounts";
import type { NetWorth } from "./types";

export interface NetWorthLine {
  key: "cash" | "assets" | "owedToUs" | "receivables" | "tenants" | "weOwe" | "debts" | "tenantsPrepaid" | "netWorth";
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
  // Phần đã khóa nằm trong tiền thật: Tích sản (tổng ví); heo, phao, sổ tiết kiệm là chỗ tiền Tích sản đang nằm (ADR-82, ADR-88) —
  // nói là một phần của Tích sản, không cộng thêm lần nữa. Nhiều hơn Tích sản (tiền có trước khi dùng app) thì kể riêng.
  const places = nw.wealthBuildingAccounts;
  const by = places.accounts.map((a) => `${wealthBuildingAccountLabel(a)} ${formatVnd(a.balance)}`).join(" · ");
  const wealthBuilding = nw.wealthBuildingCash > 0 && `Tích sản ${formatVnd(nw.wealthBuildingCash)} đã khóa`;
  const lockedParts =
    places.total > 0 && places.total <= nw.wealthBuildingCash
      ? [`${wealthBuilding} (gồm ${formatVnd(places.total)} ở tài khoản Tích sản: ${by})`]
      : [wealthBuilding, places.total > 0 && `Tài khoản Tích sản ${formatVnd(places.total)} (${by})`].filter(Boolean);
  const cashNote = [lockedParts.length > 0 ? `trong đó ${lockedParts.join(", ")}` : null, `còn để chi tuần này ${formatVnd(nw.spendableThisWeek)}`]
    .filter(Boolean)
    .join(" · ");
  const lines: (NetWorthLine | false)[] = [
    { key: "cash", level: "hero", label: "Tiền thật đang có", hint: "tiền mặt và tiền trong tài khoản", note: cashNote, value: nw.cash },
    nw.assets !== 0 && { key: "assets", level: "row", label: "Tài sản (vàng, chứng khoán…)", note: "không phải tiền mặt — bán mới thành tiền", value: nw.assets },
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
      label: "Tài sản ròng",
      note: "Cộng hết lại rồi trừ nợ. Con số quan trọng hằng ngày vẫn là tiền thật đang có ở trên.",
      value: nw.netWorth,
    },
  ];
  return lines.filter((l): l is NetWorthLine => l !== false);
}
