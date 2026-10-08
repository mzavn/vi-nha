// SePay API v2 (https://developer.sepay.vn/en/sepay-api/v2/gioi-thieu) — thay cho API cũ `my.sepay.vn/userapi/*`.
// Khác v1: trả đúng mã HTTP (401/422/429), luôn bọc trong `data`, tiền là số nguyên, id là UUID, phân trang
// `page`/`per_page` (tối đa 100), lọc ngày bằng `transaction_date_from`/`_to`. Không lọc được theo số tài khoản
// (chỉ theo UUID tài khoản), nên lấy cả công ty trong khoảng ngày rồi lọc ở app.

export const SEPAY_API = "https://userapi.sepay.vn/v2";
const PER_PAGE = 100;
const MAX_PAGES = 50; // 5.000 giao dịch một lần gọi — quá mức một hộ gia đình, chặn vòng lặp vô tận khi API trả sai
const MAX_RETRY_AFTER_S = 5;

export class SepayApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** Lỗi gọi SePay nói bằng lời cho người nhà (dùng chung cho "Kiểm tra", rà soát đêm và đồng bộ lại). */
export function sepayErrorText(err: unknown): string {
  if (err instanceof SepayApiError) return err.status === 401 || err.status === 403 ? "Token không hợp lệ." : `SePay trả lỗi HTTP ${err.status}.`;
  return "Không gọi được SePay.";
}

interface Envelope<T> {
  status?: string;
  data?: T;
  message?: string;
  error_code?: string;
  meta?: { pagination?: { has_more?: boolean } };
}

/** Một lần GET; 429 thì chờ đúng `Retry-After` (tối đa 5 giây) rồi thử lại một lần. */
async function get<T>(path: string, params: Record<string, string | number>, token: string, fetchImpl: typeof fetch): Promise<Envelope<T>> {
  const qs = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]));
  const url = `${SEPAY_API}${path}?${qs}`;
  for (let attempt = 1; ; attempt++) {
    const res = await fetchImpl(url, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
    if (res.status === 429 && attempt === 1) {
      const wait = Math.min(MAX_RETRY_AFTER_S, Math.max(1, Number(res.headers.get("Retry-After")) || 1));
      await new Promise((r) => setTimeout(r, wait * 1000));
      continue;
    }
    const body = (await res.json().catch(() => ({}))) as Envelope<T>;
    if (!res.ok) throw new SepayApiError(res.status, body.error_code ?? `http_${res.status}`, body.message ?? `SePay trả lỗi HTTP ${res.status}.`);
    return body;
  }
}

/** Mọi giao dịch của công ty trong khoảng ngày (giờ VN, "YYYY-MM-DD HH:mm:ss"), đi hết các trang. */
export async function listTransactions(range: { from: string; to: string }, token: string, fetchImpl: typeof fetch = fetch): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const body = await get<Record<string, unknown>[]>(
      "/transactions",
      { transaction_date_from: range.from, transaction_date_to: range.to, transaction_date_sort: "asc", page, per_page: PER_PAGE },
      token,
      fetchImpl,
    );
    out.push(...(body.data ?? []));
    if (!body.meta?.pagination?.has_more) break;
  }
  return out;
}

export interface SepayBankAccount {
  id: string;
  account_number: string;
  bank_short_name?: string;
  label?: string;
  active?: boolean | number;
}

/** Các tài khoản ngân hàng đã nối SePay (đi hết các trang). */
export async function listBankAccounts(token: string, fetchImpl: typeof fetch = fetch): Promise<SepayBankAccount[]> {
  const out: SepayBankAccount[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const body = await get<SepayBankAccount[]>("/bank-accounts", { page, per_page: PER_PAGE }, token, fetchImpl);
    out.push(...(body.data ?? []));
    if (!body.meta?.pagination?.has_more) break;
  }
  return out;
}
