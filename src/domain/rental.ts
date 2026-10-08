// Sổ người thuê (context rental, UC-801…805) — hàm THUẦN: tính bản nháp chốt tháng và bảng kê gửi người thuê.
// Sổ người thuê là sổ phải thu nằm ngoài sổ cái: dương = người thuê còn nợ, âm = đã trả dư, tự trừ tháng sau.

export type TenantLineKind = "opening" | "fixed" | "shared" | "one_off" | "paid_for_us" | "adjust";

export interface FeeRef {
  name: string;
  amount: number;
  active: boolean;
}

export interface DraftLine {
  kind: "fixed" | "shared";
  name: string;
  amount: number;
}

export interface LineRef {
  kind: TenantLineKind;
  name: string | null;
  amount: number;
}

export const SHARED_LINE_NAME = "Chi chung";

/** Phần chi chung mỗi người = floor(tổng / số người); phần lẻ hộ chịu. Tổng ≤ 0 thì không ai phải trả. */
export function sharePerHead(sharedTotal: number, headcount: number): number {
  if (!Number.isInteger(headcount) || headcount <= 0 || sharedTotal <= 0) return 0;
  return Math.floor(sharedTotal / headcount);
}

/** Bản nháp chốt tháng: mỗi phí cố định đang dùng một dòng, cộng một dòng chi chung (nếu > 0). Người sửa được trước khi lưu. */
export function monthDraft(fees: FeeRef[], sharedTotal: number, headcount: number): DraftLine[] {
  const draft: DraftLine[] = fees.filter((f) => f.active && f.amount > 0).map((f) => ({ kind: "fixed", name: f.name, amount: f.amount }));
  const share = sharePerHead(sharedTotal, headcount);
  if (share > 0) draft.push({ kind: "shared", name: SHARED_LINE_NAME, amount: share });
  return draft;
}

const MINUS = "−";
const money = (n: number) => `${n < 0 ? MINUS : ""}${Math.abs(Math.round(n)).toLocaleString("vi-VN")} ₫`;

const KIND_LABEL: Record<TenantLineKind, string> = {
  opening: "Số dư mở sổ",
  fixed: "Phí cố định",
  shared: SHARED_LINE_NAME,
  one_off: "Phí một lần",
  paid_for_us: "Chi hộ",
  adjust: "Điều chỉnh",
};

export interface StatementInput {
  tenantName: string;
  month: string; // "2026-10"
  settled: boolean;
  openingBalance: number;
  sharedTotal: number;
  headcount: number;
  /** Dòng sổ đã ghi trong tháng (gồm cả dòng chốt nếu đã chốt). */
  lines: LineRef[];
  /** Bản nháp chốt (chỉ khi chưa chốt). */
  draft: DraftLine[];
  /** Tiền người thuê đã chuyển trong tháng; `day` dạng "2026-10-05". */
  payments: { day: string; amount: number }[];
}

/** Số dư cuối tháng (tạm tính nếu chưa chốt) = đầu kỳ + dòng sổ + nháp − đã chuyển. */
export function closingBalance(input: Pick<StatementInput, "openingBalance" | "lines" | "draft" | "payments">): number {
  const sum = (xs: { amount: number }[]) => xs.reduce((s, x) => s + x.amount, 0);
  return input.openingBalance + sum(input.lines) + sum(input.draft) - sum(input.payments);
}

/** Bảng kê chữ thường để copy gửi người thuê. */
export function statementText(input: StatementInput): string {
  const [y, m] = input.month.split("-");
  const out: string[] = [`Bảng kê tháng ${Number(m)}/${y} — ${input.tenantName}${input.settled ? "" : " (tạm tính)"}`];
  out.push(`Số dư tháng trước: ${money(input.openingBalance)}`);
  const sharedNote = `${money(input.sharedTotal)} ÷ ${input.headcount} người`;
  const label = (l: LineRef) => {
    if (l.kind === "shared") return `${l.name || SHARED_LINE_NAME} (${sharedNote})`;
    if (l.kind === "paid_for_us") return `${input.tenantName} đã chi hộ${l.name ? ` (${l.name})` : ""}`;
    return l.name || KIND_LABEL[l.kind];
  };
  for (const l of [...input.lines, ...input.draft]) out.push(`${label(l)}: ${money(l.amount)}`);
  for (const p of input.payments) {
    const [, pm, pd] = p.day.split("-");
    out.push(`Đã chuyển ${pd}/${pm}: ${money(-p.amount)}`);
  }
  const closing = closingBalance(input);
  if (closing > 0) out.push(`Còn phải trả: ${money(closing)}`);
  else if (closing < 0) out.push(`Trả dư: ${money(-closing)} — trừ vào tháng sau`);
  else out.push("Đã thanh toán đủ");
  return out.join("\n");
}
