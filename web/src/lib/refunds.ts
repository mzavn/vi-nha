// Nối khoản tiền về với khoản gốc (pwa UC-705, UC-706, UC-715): "Trả lại cho khoản chi" (hoàn tiền → khoản chi) và
// "Trả cho khoản cho vay" (nhận lại → khoản cho vay) — xếp, nhãn, dòng chênh; ở chi tiết giao dịch: dòng "Trả cho" và
// mục "Đã nhận lại". Thuần, không đụng DOM hay mạng. Danh sách đến từ GET /v1/transactions/link-candidates (một lần tải;
// đổi số tiền hay người chỉ xếp lại).

import { formatSigned, formatVnd } from "./money";
import { shortDate } from "./period";
import type { LinkCandidate, TxLink } from "./types";

/** Loại khoản gốc: `spend` cho dòng Hoàn tiền, `lend` cho dòng Nhận lại tiền cho vay. */
export type LinkKind = "spend" | "lend";

/** Khoản chi 30 ngày, khoản cho vay 180 ngày gần nhất; app xếp và cắt còn 20 (`rankLinkCandidates`). */
export const LINK_DAYS: Record<LinkKind, number> = { spend: 30, lend: 180 };
export const linkCandidatesPath = (kind: LinkKind) => `/v1/transactions/link-candidates?meaning=${kind}&days=${LINK_DAYS[kind]}`;

/** Khoản gốc còn chờ gán thì chưa có trong danh sách. */
export const LINK_PENDING_HINT = "Khoản gốc còn chờ gán? Gán nó trước rồi quay lại.";

/**
 * Dòng nhắc khi chưa chọn khoản gốc. Người đang chọn có khoản cho vay trong danh sách → nói thẳng có mấy khoản để chọn
 * (chủ nhà thấy "Khoản gốc còn chờ gán?" trong khi khoản cho vay 244.000 của C Mai đã có, tưởng phải gỡ liên kết).
 * Không có khoản nào thì mới nhắc gán khoản gốc trước.
 */
export function linkPickHint(kind: LinkKind, candidates: Pick<LinkCandidate, "receivable_id" | "receivable_name">[], receivableId: string | null): string {
  if (kind === "lend" && receivableId) {
    const mine = candidates.filter((c) => c.receivable_id === receivableId);
    if (mine.length > 0) return `${mine[0]!.receivable_name ?? "Người này"} có ${mine.length} khoản cho vay ở ô trên — chọn khoản đang trả.`;
  }
  if (candidates.length > 0) return `Có ${candidates.length} khoản ở ô trên — chọn khoản gốc nếu biết, không thì để trống.`;
  return LINK_PENDING_HINT;
}

/**
 * Thứ tự trong ô chọn khoản gốc: khoản của người đang chọn (`receivableId`, chỉ khoản cho vay) lên trước; rồi `near` khoản
 * gần số tiền nhất (|chênh| tăng dần, bằng nhau thì mới nhất trước); **rồi mọi khoản còn lại, mới nhất trước** — không cắt bớt.
 * Trước đây chỉ giữ 20 khoản gần số tiền nhất, nên chia bill (bill 800.000, mỗi người trả 200.000) mất bill khỏi danh sách
 * khi trong 30 ngày có nhiều khoản chi quanh 200.000. Danh sách đã giới hạn sẵn theo số ngày (30 / 180).
 */
export function rankLinkCandidates(rows: LinkCandidate[], amount: number, receivableId: string | null = null, near = 5): LinkCandidate[] {
  const other = (c: LinkCandidate) => (receivableId !== null && c.receivable_id === receivableId ? 0 : 1);
  const newest = (a: LinkCandidate, b: LinkCandidate) => b.at.localeCompare(a.at) || b.id - a.id;
  const closest = [...rows].sort((a, b) => other(a) - other(b) || Math.abs(a.amount - amount) - Math.abs(b.amount - amount) || newest(a, b)).slice(0, near);
  const rest = rows.filter((c) => !closest.includes(c)).sort((a, b) => other(a) - other(b) || newest(a, b));
  return [...closest, ...rest];
}

/**
 * Mục trong ô chọn: "d/m · {danh mục (khoản chi) / người vay (khoản cho vay)} · {ghi chú, không có thì nội dung ngân hàng —
 * cắt ở 40 ký tự} · X ₫".
 */
export function linkCandidateLabel(kind: LinkKind, c: LinkCandidate): string {
  const what = c.note?.trim() || c.bank_content?.trim() || "";
  const clipped = what.length > 40 ? `${what.slice(0, 39).trimEnd()}…` : what;
  const head = kind === "lend" ? (c.receivable_name ?? "khoản cho vay") : (c.category_name ?? "khoản chi");
  return [shortDate(c.at), head, clipped, formatVnd(c.amount)].filter(Boolean).join(" · ");
}

/**
 * Dòng dưới ô sau khi chọn khoản chi: "Khoản chi X · trả lại Y · chênh ±Z ₫ (nằm lại trong danh mục {tên})" — trả hơn thì
 * phần dư làm danh mục chi ít đi, trả kém thì phần thiếu vẫn là đã chi. Trả đúng bằng: "… · trả đủ".
 */
export function refundDiffText(spend: Pick<LinkCandidate, "amount" | "category_name">, refund: number): string {
  const head = `Khoản chi ${formatVnd(spend.amount)} · trả lại ${formatVnd(refund)}`;
  const diff = refund - spend.amount;
  if (diff === 0) return `${head} · trả đủ`;
  return `${head} · chênh ${formatSigned(diff)}\u00a0₫${spend.category_name ? ` (nằm lại trong danh mục ${spend.category_name})` : ""}`;
}

/** Dòng dưới ô sau khi chọn khoản cho vay: "Cho vay X · trả lại Y · còn Z" / "… · trả dư Z" / "… · trả đủ" (riêng lần trả này). */
export function lendDiffText(lend: Pick<LinkCandidate, "amount">, collect: number): string {
  const short = lend.amount - collect;
  const gap = short > 0 ? `còn ${formatVnd(short)}` : short < 0 ? `trả dư ${formatVnd(-short)}` : "trả đủ";
  return `Cho vay ${formatVnd(lend.amount)} · trả lại ${formatVnd(collect)} · ${gap}`;
}

/**
 * Chi tiết giao dịch, dòng "Trả cho": "khoản chi d/m · X ₫" / "khoản cho vay d/m · X ₫"; khoản gốc đã bị xoá (liên kết
 * vẫn giữ — xoá không gỡ liên kết) thì thêm " · khoản gốc đã xoá".
 */
export function linkOriginText(link: Pick<TxLink, "meaning" | "at" | "amount" | "status">): string {
  const head = `${link.meaning === "lend" ? "khoản cho vay" : "khoản chi"} ${shortDate(link.at)} · ${formatVnd(link.amount)}`;
  return link.status === "active" ? head : `${head} · khoản gốc đã xoá`;
}

/**
 * Chi tiết khoản chi / khoản cho vay, mục "Đã nhận lại": tổng các khoản trả về và chênh so với khoản gốc —
 * "X ₫ · trả dư Z" / "X ₫ · còn thiếu Z" / "X ₫ · đủ".
 */
export function returnedText(original: number, linked: { amount: number }[]): string {
  const total = linked.reduce((s, l) => s + l.amount, 0);
  const short = original - total;
  return `${formatVnd(total)} · ${short > 0 ? `còn thiếu ${formatVnd(short)}` : short < 0 ? `trả dư ${formatVnd(-short)}` : "đủ"}`;
}
