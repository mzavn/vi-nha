// Định dạng tiền theo DESIGN.md §5: `1.250.000 ₫`, dấu trừ U+2212, không bao giờ làm tròn.

export const MINUS = "−";
/** Khoảng trắng không ngắt dòng giữa số và ₫ — để ₫ không rơi xuống dòng riêng. */
const NBSP = " ";

/** `-1250000` → `−1.250.000`. Phần lẻ (nếu có) giữ nguyên, ngăn bằng dấu phẩy. */
export function groupDigits(n: number): string {
  const [int = "0", frac] = String(Math.abs(n)).split(".");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return (n < 0 ? MINUS : "") + grouped + (frac ? `,${frac}` : "");
}

export function formatVnd(n: number): string {
  return `${groupDigits(n)}${NBSP}₫`;
}

/** Có dấu + cho số dương — dùng cho chênh lệch. */
export function formatSigned(n: number): string {
  return n > 0 ? `+${groupDigits(n)}` : groupDigits(n);
}

/** Chuỗi người dùng gõ (có thể lẫn dấu chấm, khoảng trắng) → số đồng, hoặc 0. */
export function parseAmount(text: string): number {
  const digits = text.replace(/\D/g, "").replace(/^0+(?=\d)/, "");
  return digits ? Number(digits.slice(0, 13)) : 0;
}

export const MAX_AMOUNT = 1_000_000_000_000;

/** Ô nhập số tiền: đọc chuỗi vừa gõ; vượt trần server thì giữ số trước đó. */
export function nextAmount(previous: number, text: string): number {
  const n = parseAmount(text);
  return n > MAX_AMOUNT ? previous : n;
}

/** Chữ hiện trong ô nhập: `1.250.000`, số 0 thì để trống cho placeholder. */
export const amountText = (n: number): string => (n ? groupDigits(n) : "");

/** Có dấu phép tính sau một chữ số (`24+`, `24+55`, `3×20`) — ô số tiền chuyển sang chế độ tính (UC-703).
 *  Dán `-50.000` (dấu trừ đứng đầu) vẫn là số thường. */
export const isAmountExpr = (text: string): boolean => /\d[\s.]*[+\-−×*]/.test(text);

/** Phép tính đang gõ: mỗi số nhóm chấm như số thường (`24000+55000` → `24.000+55.000`), dấu phép tính và khoảng trắng
 *  giữ nguyên — `evalAmount` coi dấu chấm là phân nhóm nên kết quả không đổi. `caret`: vị trí con trỏ trong chữ cũ;
 *  trả về vị trí tương ứng trong chữ mới (sau cùng số ký tự không phải dấu chấm). */
export function groupExpr(text: string, caret = text.length): { text: string; caret: number } {
  const grouped = text.replace(/\d[\d.]*/g, (run) => run.replace(/\./g, "").replace(/\B(?=(\d{3})+(?!\d))/g, "."));
  let keep = text.slice(0, caret).replace(/\./g, "").length;
  let at = 0;
  while (keep > 0 && at < grouped.length) if (grouped[at++] !== ".") keep--;
  return { text: grouped, caret: at };
}

/** Tính phép tính trong ô số tiền, không dùng eval: số (dấu chấm, khoảng trắng là phân nhóm), `+`, `-`/`−`, `×`/`*`
 *  (nhân trước, cộng trừ sau), cùng đơn vị đồng như ô hiện. Dấu phép tính ở cuối (đang gõ dở) bỏ qua.
 *  Không ra số tiền hợp lệ — ký tự lạ, hai dấu liền nhau, kết quả ≤ 0, vượt trần — thì null. */
export function evalAmount(text: string): number | null {
  const s = text.replace(/[\s.]/g, "").replace(/[+\-−×*]$/, "");
  if (!/^\d+([+\-−×*]\d+)*$/.test(s)) return null;
  let sum = 0;
  for (const part of s.match(/^[^+\-−]+|[+\-−][^+\-−]+/g) ?? []) {
    let term = 1;
    for (const f of part.replace(/^[+\-−]/, "").split(/[×*]/)) {
      term *= Number(f);
      if (term > MAX_AMOUNT) return null;
    }
    sum += part[0] === "-" || part[0] === "−" ? -term : term;
  }
  return sum > 0 && sum <= MAX_AMOUNT ? sum : null;
}

/** Nút nhanh +50k…: cộng dồn, kẹp ở trần. */
export const addAmount = (current: number, add: number): number => Math.min(current + add, MAX_AMOUNT);

/** Nút "+000": thêm ba số 0 vào cuối; vượt trần thì giữ nguyên. */
export const timesThousand = (current: number): number => (current * 1000 > MAX_AMOUNT ? current : current * 1000);
