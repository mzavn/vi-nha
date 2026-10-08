// Engine khớp rule cho bank feed SePay — hàm THUẦN: không đọc DB, không gọi fetch.
// Học theo hành vi MzaSepaySheetLib đang chạy thật (đọc 22/9/2026, xem phase-04):
//   mã 3 chữ cái [QE]xx bắt bằng regex, không có mã thì dò từ khoá trên nội dung đã bỏ dấu + viết hoa.

export type RuleMatchType = "code" | "content" | "account";
export type RuleMeaning = "spend" | "transfer" | "income";

export interface RuleRow {
  id: number;
  priority: number;
  matchType: RuleMatchType;
  pattern: string;
  meaning: RuleMeaning;
  isSalary: boolean;
  walletId: string | null;
  categoryId: string | null;
  byMemberId: string | null;
}

const CODE_RE = /\b[QE][A-Z]{2}\b/;
/** Nội dung lệnh chuyển tiền do chính app sinh ra: 'PF' + 6 ký tự ngẫu nhiên; dò dung sai khoảng trắng/hoa thường. */
const PF_MEMO_RE = /\bPF\s*([0-9A-Z]{6})\b/;

/** Bỏ dấu tiếng Việt + viết hoa, đúng như MzaSepaySheetLib đang làm trước khi so khớp từ khoá. */
export function normalizeContent(content: string | null | undefined): string {
  if (!content) return "";
  return content
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/gi, "d")
    .toUpperCase()
    .replace(/\s+/g, " ") // ngân hàng hay chèn nhiều khoảng trắng / tab giữa các từ
    .trim();
}

/** Bắt mã 3 chữ cái [QE]xx trong nội dung (không phân biệt hoa thường), trả về dạng viết hoa. */
export function extractCode(content: string | null | undefined): string | null {
  const m = normalizeContent(content).match(CODE_RE);
  return m ? m[0] : null;
}

/** Bắt mã lệnh chuyển tiền 'PF XXXXXX' trong nội dung, trả về đúng chuỗi memo đã lưu ở transfer_orders.memo. */
export function extractTransferMemo(content: string | null | undefined): string | null {
  const m = normalizeContent(content).match(PF_MEMO_RE);
  return m ? `PF ${m[1]!}` : null;
}

/**
 * Nội dung ngân hàng trông như rút tiền mặt (ATM / quầy) — chỉ khi đó màn Gán mới gợi ý "Rút tiền mặt" cho log `out`
 * không khớp rule (ingest UC-305). Danh sách cố ý ngắn, so trên nội dung đã `normalizeContent`, theo từ trọn vẹn:
 * `ATM` ("RUT TIEN TAI ATM MB" — mẫu MB trong test; "RUT TIEN ATM 0011xxx" — mẫu VCB trong docs/pf-wireframe.html),
 * `RUT TIEN` / `RUT TM` (rút tiền mặt tại quầy, viết tắt), `CASH WITHDRAWAL` (sao kê thẻ tiếng Anh).
 * Trả quán qua QR, thanh toán hoá đơn, chuyển khoản thường không có các từ này → không gợi ý.
 */
export function looksLikeCashWithdrawal(content: string | null | undefined): boolean {
  return /\b(ATM|RUT TIEN|RUT TM|CASH WITHDRAWAL)\b/.test(normalizeContent(content));
}

/**
 * Khớp rule theo đúng thứ tự docs/core_design_rules.md + phase-04: mã chính xác trước, rồi từ khoá nội dung,
 * rồi tài khoản/tên thụ hưởng; trong từng loại thì ưu tiên số nhỏ trước. `code` truyền vào là ref_code đã lưu
 * ở bank_logs (payload.code nếu có, không thì đã tự bắt từ content lúc nhận log — không bắt lại ở đây).
 * Rule `income` chỉ khớp khi hướng tiền là 'in' và rule đó `is_salary` (luật 6: máy không được đoán thu nhập,
 * trừ mẫu lương). Rule `spend`/`transfer` chỉ khớp khi hướng tiền là 'out'.
 */
export function matchRule(rules: RuleRow[], direction: "in" | "out", content: string | null, code: string | null): RuleRow | null {
  const norm = normalizeContent(content);
  const upperCode = code?.toUpperCase() ?? null;
  const eligible = (r: RuleRow) => (r.meaning === "income" ? direction === "in" && r.isSalary : direction === "out");
  const byType = (type: RuleMatchType) => rules.filter((r) => r.matchType === type && eligible(r)).sort((a, b) => a.priority - b.priority);

  for (const r of byType("code")) {
    if (upperCode && upperCode === r.pattern.toUpperCase()) return r;
  }
  for (const r of byType("content")) {
    if (norm.includes(r.pattern.toUpperCase())) return r;
  }
  for (const r of byType("account")) {
    if (norm.includes(r.pattern.toUpperCase())) return r;
  }
  return null;
}

export interface PairCandidate {
  id: string;
  accountId: string;
  direction: "in" | "out";
  amount: number;
  at: string; // ISO
}

const PAIR_WINDOW_MS = 10 * 60_000;

/**
 * Quyết định ghép cặp 2 log thành 1 transfer nội bộ (docs/core_design_rules.md §6, bước 2+3; phase-04 bước 2+3).
 * `account_id` của bank_logs chỉ bao giờ trỏ tới tài khoản CỦA HỘ (SePay chỉ bắn webhook cho TK đã đăng ký),
 * nên "tài khoản đối ứng thuộc accounts của hộ" và "ghép theo số tiền + thời điểm" là MỘT cơ chế: tìm log
 * ngược hướng, cùng số tiền, khác tài khoản, trong vòng 10 phút. Rủi ro chấp nhận: hai giao dịch không liên
 * quan trùng số tiền ngẫu nhiên trong cùng khung giờ vẫn bị ghép nhầm — giảm thiểu bằng tin sáng + gỡ cặp tay.
 */
export function canPair(a: PairCandidate, b: PairCandidate): boolean {
  if (a.accountId === b.accountId) return false;
  if (a.direction === b.direction) return false;
  if (a.amount !== b.amount) return false;
  return Math.abs(Date.parse(a.at) - Date.parse(b.at)) <= PAIR_WINDOW_MS;
}

/**
 * Mẫu rule rút từ nội dung một log, cho nút "Tạo rule từ nội dung này".
 * Có mã [QE]xx thì dùng mã. Không có thì lấy đoạn chữ liền nhau dài nhất (bỏ các cụm có chữ số như mã giao dịch,
 * số tài khoản, ngày giờ — chúng đổi mỗi lần nên rule sẽ không bao giờ khớp lại), tối đa 4 từ, và đoạn đó
 * luôn nằm nguyên văn trong nội dung đã chuẩn hoá nên `matchRule` khớp được ngay chính log này.
 */
export function suggestRulePattern(content: string | null | undefined): { matchType: "code" | "content"; pattern: string } | null {
  const code = extractCode(content);
  if (code) return { matchType: "code", pattern: code };
  const tokens = normalizeContent(content).split(/\s+/).filter(Boolean);
  let best: string[] = [];
  let run: string[] = [];
  for (const t of [...tokens, "0"]) {
    if (/\d/.test(t) || !/[A-Z]/.test(t)) {
      if (run.join(" ").length > best.join(" ").length) best = run;
      run = [];
    } else run.push(t);
  }
  const pattern = best.slice(0, 4).join(" ");
  return pattern.length >= 3 ? { matchType: "content", pattern } : null;
}
