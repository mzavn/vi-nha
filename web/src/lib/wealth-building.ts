// Tab Tích sản (pwa UC-707, GET /v1/wealth-building — ADR-86): tiền nào, loại nào, đang ở đâu, đến từ đâu. Thuần để test.
// Mọi số đi qua `Money` / `formatVnd` — không rút gọn kiểu "76k" trên card này.

import { formatSigned, formatVnd } from "./money";
import { ROLE_LABEL, wealthBuildingAccountLabel } from "./wealth-building-accounts";
import type { WealthBuildingAccount, WealthBuildingBreakdown } from "./types";

export interface WealthBuildingLine {
  key: string;
  /** row: một nhóm · part: chi tiết của nhóm ngay trên. */
  level: "row" | "part";
  label: string;
  /** Câu phụ nói con số này là gì; null khi nhãn đã đủ. */
  note: string | null;
  value: number;
}

/** Nhãn loại tài sản, vd `{ gold: "Vàng" }`; loại lạ thì hiện mã. */
export type AssetLabels = Record<string, string>;

const times = (n: number) => `(${n} lần)`;

/** Loại: tiền và tài sản, tài sản kèm từng loại đã mua (theo các khoản mua còn hiệu lực). */
export function wealthBuildingKinds(b: WealthBuildingBreakdown, labels: AssetLabels): WealthBuildingLine[] {
  const parts = b.flows
    .filter((f) => f.kind === "buy_asset")
    .map((f): WealthBuildingLine => ({ key: `asset:${f.assetKind ?? ""}`, level: "part", label: (f.assetKind && labels[f.assetKind]) || f.assetKind || "Không rõ loại", note: `${f.count} lần mua`, value: f.amount }));
  return [
    { key: "cash", level: "row", label: "Tiền", note: "tiền để dành, dùng được lúc khẩn cấp — Quỹ an tâm chỉ đếm phần này", value: b.cash },
    { key: "assets", level: "row", label: "Tài sản", note: parts.length > 0 ? "đã mua bằng tiền Tích sản — bán mới thành tiền" : "chưa mua tài sản nào", value: b.assets },
    ...parts,
  ];
}

export interface WealthBuildingPlaces {
  lines: WealthBuildingLine[];
  /** Tài khoản Tích sản có nhiều hơn tiền Tích sản: nói tổng, phần là Tích sản và phần dư (số dư có từ trước khi dùng app / lãi). */
  extra: string | null;
}

const PLACE_NOTE: Record<WealthBuildingAccount["role"], string> = {
  piggy_bank: "tiết kiệm tiền lẻ — rút về được khi cần",
  buffer: "rút được ngay khi cần",
  term_deposit: "gửi có kỳ hạn — tất toán mới rút được",
};

/**
 * Tiền Tích sản đang nằm ở đâu (ADR-86, ADR-88): mỗi tài khoản Tích sản (heo đất, phao, sổ tiết kiệm) một dòng với số dư
 * sổ thật (âm thì để âm, có log chờ gán thì nói); phần ở đó tính tối đa bằng tiền Tích sản, phần còn lại "trong các tài
 * khoản thường" — sổ không biết tài khoản nào.
 */
export function wealthBuildingPlaces(b: WealthBuildingBreakdown): WealthBuildingPlaces {
  const places = b.accounts
    .filter((a) => a.balance !== 0 || a.pendingCount > 0)
    .map((a): WealthBuildingLine => {
      const piggyBank = a.role === "piggy_bank";
      const notes = [
        a.balance < 0 && (piggyBank ? "sổ ghi rút ra nhiều hơn bỏ vào — tiền lãi hoặc tiền heo từ trước khi dùng app chưa tách" : "sổ ghi rút ra nhiều hơn chuyển vào — tiền lãi hoặc tiền có từ trước khi dùng app chưa tách"),
        a.pendingCount > 0 && `còn ${a.pendingCount} khoản ${piggyBank ? "bỏ / rút heo" : "chuyển vào / rút ra"} đang chờ gán (${formatSigned(a.pendingNet)}${"\u00a0"}₫)`,
      ].filter((s): s is string => typeof s === "string");
      return { key: `${a.role}:${a.accountId}`, level: "row", label: wealthBuildingAccountLabel(a), note: notes.length > 0 ? notes.join(" · ") : PLACE_NOTE[a.role], value: a.balance };
    });
  const cash = Math.max(0, b.cash);
  const held = b.accounts.reduce((s, a) => s + Math.max(0, a.balance), 0);
  const regular = cash - Math.min(held, cash);
  const lines = [...places];
  if (regular > 0) {
    lines.push({ key: "regular", level: "row", label: "Trong các tài khoản thường", note: "ví chỉ là phần ngân sách — sổ không theo dõi tài khoản nào giữ phần này", value: regular });
  }
  const over = held - cash;
  return { lines, extra: over > 0 ? placesExtra(b.accounts, held, cash, over) : null };
}

/** "Heo đất và phao dự phòng đang có 136.364 ₫: 76.300 ₫ là tiền Tích sản, 60.064 ₫ còn lại …" — chỉ kể loại tài khoản đang có tiền. */
function placesExtra(accounts: WealthBuildingAccount[], held: number, cash: number, over: number): string {
  const roles = (["piggy_bank", "buffer", "term_deposit"] as const).filter((r) => accounts.some((a) => a.role === r && a.balance > 0)).map((r) => ROLE_LABEL[r].toLowerCase());
  const names = roles.length > 1 ? `${roles.slice(0, -1).join(", ")} và ${roles.at(-1)}` : (roles[0] ?? "");
  const where = `${names.charAt(0).toUpperCase()}${names.slice(1)} đang có ${formatVnd(held)}`;
  const rest = "số dư có từ trước khi dùng app hoặc tiền lãi — chưa tính vào Tích sản.";
  return cash > 0 ? `${where}: ${formatVnd(cash)} là tiền Tích sản, ${formatVnd(over)} còn lại là ${rest}` : `${where}, đều là ${rest}`;
}

export interface WealthBuildingSources {
  ins: WealthBuildingLine[];
  outs: WealthBuildingLine[];
  /** Còn lại là tiền: vào − ra − mua tài sản = `cash`. */
  cash: number;
  /** Có phần chia từ thu nhập: nói vì sao sổ giao dịch không có dòng của nó; không có thì null. */
  fundNote: string | null;
}

/** Tiền vào / ra ví Tích sản theo nguồn, lớn trước (server đã xếp). */
export function wealthBuildingSources(b: WealthBuildingBreakdown, labels: AssetLabels): WealthBuildingSources {
  const line = (f: WealthBuildingBreakdown["flows"][number]): WealthBuildingLine => {
    const key = `${f.direction}:${f.kind}:${f.accountId ?? f.walletId ?? f.assetKind ?? ""}`;
    const row = (label: string, note: string | null = null): WealthBuildingLine => ({ key, level: "row", label, note, value: f.amount });
    switch (f.kind) {
      case "piggy_bank":
        return row(`Bỏ heo đất ${f.memberName ?? f.accountName ?? ""} ${times(f.count)}`, "tiền lẻ làm tròn / gửi tích lũy MB vào heo");
      case "buffer":
        return row(`Chuyển vào phao ${f.accountName ?? ""} ${times(f.count)}`, "chuyển từ tài khoản thường vào phao dự phòng");
      case "term_deposit":
        return row(`Gửi sổ tiết kiệm ${f.accountName ?? ""} ${times(f.count)}`, "gửi thẳng từ tài khoản thường");
      case "fund":
        return row(`Chia từ thu nhập (${f.count} lần chia)`, "phần Tích sản của mỗi lần chia lương / thu nhập");
      case "sweep":
        return row(`Quét dư cuối tháng ${times(f.count)}`, "phong bì chung còn dư khi chốt tháng");
      case "tax":
        return row("Thuế dư sau quyết toán", null);
      case "opening":
        return row(`Số dư có sẵn khi mở tài khoản ${times(f.count)}`, "tiền có sẵn trong heo / phao / sổ tiết kiệm trước khi ghi vào app — tính một lần vào Tích sản");
      case "wallet":
        if (f.direction === "out") return row(`Chuyển sang ví ${f.walletName ?? ""} ${times(f.count)}`);
        return f.walletActive === false
          ? row(`Chuyển số dư ví ${f.walletName ?? ""} cũ`, "ví đã tắt — số dư của nó chuyển hết sang Tích sản")
          : row(`Chuyển từ ví ${f.walletName ?? ""} ${times(f.count)}`);
      case "buy_asset":
        return row(`Mua tài sản: ${(f.assetKind && labels[f.assetKind]) || f.assetKind || "Không rõ loại"} ${times(f.count)}`, "tiền thành tài sản, vẫn thuộc Tích sản");
      case "other":
        return row(`Khác ${times(f.count)}`);
    }
  };
  return {
    ins: b.flows.filter((f) => f.direction === "in").map(line),
    outs: b.flows.filter((f) => f.direction === "out").map(line),
    cash: b.cash,
    fundNote: b.flows.some((f) => f.kind === "fund")
      ? "Phần chia từ thu nhập không hiện thành dòng riêng trong sổ — sổ chỉ có khoản thu gốc; tổng ở trên đã gồm phần đó."
      : null,
  };
}

/** Quỹ an tâm (snapshot `safetyFund`) — dùng chung cho tab Tích sản và Hôm nay. */
export interface SafetyFundView {
  cash: number;
  target: number;
  months: number;
  monthsCovered: number | null;
}

/**
 * Số tháng chi Must mà Quỹ an tâm đã che, kiểu "2,5 / 6": server làm tròn 1 số lẻ nên có tiền mà chưa tới 0,05 tháng ra 0 —
 * hiện "dưới 0,1" thay vì "0" cạnh một số tiền dương. null khi chưa tính được.
 */
export function safetyFundMonthsText(fund: SafetyFundView): string | null {
  if (fund.monthsCovered === null) return null;
  const covered = fund.monthsCovered === 0 && fund.cash > 0 ? "dưới 0,1" : String(fund.monthsCovered).replace(".", ",");
  return `${covered} / ${fund.months}`;
}

/** "Có 76.300 ₫ · cần 110.550.000 ₫" ("cần ước tính …" khi mức cần đang ước từ ngân sách). */
export function safetyFundCashText(fund: SafetyFundView, estimated = false): string {
  return `Có ${formatVnd(fund.cash)} · cần ${estimated ? "ước tính " : ""}${formatVnd(fund.target)}`;
}
