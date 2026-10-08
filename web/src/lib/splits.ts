// Tách một log ngân hàng thành nhiều dòng: tổng các dòng phải bằng đúng số tiền log (phase 04, lớp 2).
// Hình dạng `Split` khớp src/services/ingest.ts — không import trực tiếp vì file đó kéo theo kiểu D1.

import { formatVnd } from "./money";
import { ordersLeft, walletRemain } from "./pending";
import type { WalletStatus } from "./types";

export type SplitMeaning = "spend" | "transfer" | "income" | "refund" | "lend" | "collect" | "buy_asset";

export interface Split {
  meaning: SplitMeaning;
  amount: number;
  wallet_id?: string | null;
  category_id?: string | null;
  other_account_id?: string | null;
  taxable?: boolean;
  asset_kind?: string | null;
  note?: string | null;
  /** transfer: chuyển kèm số giữa hai ví (cả hai hoặc không). wallet_id là ví đích. */
  from_wallet_id?: string | null;
  /** income: nguồn thu (phần khóa) và người thuê trả tiền. */
  income_stream_id?: string | null;
  tenant_id?: string | null;
  /** spend: khoản chi này trả cho khoản nợ nào trong sổ nợ. */
  debt_id?: string | null;
  /** lend / collect: cho vay hay nhận lại tiền gắn vào khoản nào trong sổ phải thu. */
  receivable_id?: string | null;
  /** refund / collect: khoản gốc được trả (ô "Trả lại cho khoản chi" / "Trả cho khoản cho vay"). */
  link_id?: number | null;
}

/** "tenant" chỉ là lựa chọn trên màn hình: gửi lên thành income kèm tenant_id. */
export type AssignChoice = SplitMeaning | "tenant";

/**
 * Hàng chip "Gán thành" theo chiều tiền (UC-706), mỗi loại kèm đúng một dòng giải thích hiện dưới hàng chip.
 * Bảng đầy đủ, ví dụ trả hơn / kém: hướng dẫn `ngan-hang/tien-vao-chon-loai` (GUIDE_PICK_KIND_URL).
 */
export const ASSIGN_CHOICES: Record<"in" | "out", { value: AssignChoice; label: string; hint: string }[]> = {
  in: [
    { value: "income", label: "Thu nhập", hint: "Tiền mới của nhà (lương, thưởng, lãi, quà) — sẽ được chia vào các ví." },
    { value: "tenant", label: "Thu từ người thuê", hint: "Người thuê trả tiền — trừ vào số họ còn nợ, chia theo nguồn cho thuê." },
    {
      value: "refund",
      label: "Hoàn tiền",
      hint: "Khoản nhà mình chi rồi được trả lại một phần (chia bill, shop hoàn) — chọn khoản chi đó; danh mục còn đúng phần nhà mình.",
    },
    {
      value: "collect",
      label: "Nhận lại tiền cho vay",
      hint: "Người ta trả khoản đã ghi Cho vay (cả mua hộ) — chọn đúng lần cho vay, không chia. Trả dư thì Tách thêm dòng Thu nhập cho phần dư.",
    },
    { value: "transfer", label: "Chuyển nội bộ", hint: "Tiền của chính nhà mình chuyển qua lại — không phải thu, không chia." },
  ],
  out: [
    { value: "spend", label: "Chi tiêu", hint: "Nhà mình tiêu tiền — trừ vào ví của danh mục. Trả cả bill mà nhà mình có phần: ghi đủ ở đây, phần người khác chuyển lại ghi Hoàn tiền." },
    { value: "transfer", label: "Chuyển nội bộ", hint: "Tiền của chính nhà mình chuyển qua lại (sang tài khoản khác, rút tiền mặt) — không phải chi." },
    {
      value: "lend",
      label: "Cho vay",
      hint: "Cho mượn tiền, hay mua hộ / trả hộ người khác (nhà mình không có phần) — người ta sẽ trả lại. Không trừ ví, ghi vào sổ phải thu.",
    },
    { value: "buy_asset", label: "Mua tài sản", hint: "Mua vàng, cổ phiếu, chứng chỉ quỹ, nhà đất — tiền thành tài sản của Tích sản, không phải chi tiêu." },
  ],
};

/** Hướng dẫn sử dụng (GitBook) — thanh bên máy tính và Cài đặt › Máy này dẫn tới. */
export const GUIDE_URL = "https://mzavn.gitbook.io/vi-nha";
/** Đăng ký SePay qua link giới thiệu của Ví nhà — Cài đặt › Kết nối › SePay. */
export const SEPAY_REGISTER_URL = "https://my.sepay.vn/register?gcid=arqcwdek";
/** Mã nguồn Ví nhà (AGPL-3.0) — Cài đặt › Máy này › Về Ví nhà (điện thoại) và chân thanh bên (máy tính). */
export const SOURCE_URL = "https://github.com/mzavn/vi-nha";

/** Trang hướng dẫn "Tiền vào: chọn loại nào?" — banner "Tiền vào luôn phải hỏi" ở màn Gán dẫn tới. */
export const GUIDE_PICK_KIND_URL = `${GUIDE_URL}/ngan-hang/tien-vao-chon-loai`;

export interface SplitCheck {
  ok: boolean;
  sum: number;
  /** total − sum: dương là còn thiếu, âm là thừa. */
  diff: number;
  message: string | null;
}

export function validateSplits(total: number, splits: Split[]): SplitCheck {
  const sum = splits.reduce((s, x) => s + (Number.isInteger(x.amount) ? x.amount : 0), 0);
  const diff = total - sum;
  const fail = (message: string): SplitCheck => ({ ok: false, sum, diff, message });

  if (splits.length === 0) return fail("Cần ít nhất một dòng.");
  const idx = splits.findIndex((s) => !Number.isInteger(s.amount) || s.amount <= 0);
  if (idx >= 0) return fail(`Dòng ${idx + 1} chưa có số tiền.`);
  const noCat = splits.findIndex((s) => s.meaning === "spend" && !s.category_id);
  if (noCat >= 0) return fail(`Dòng ${noCat + 1} là khoản chi, cần danh mục.`);
  const noAcct = splits.findIndex((s) => s.meaning === "transfer" && !s.other_account_id);
  if (noAcct >= 0) return fail(`Dòng ${noAcct + 1} là chuyển nội bộ, cần tài khoản đầu kia.`);
  const halfMove = splits.findIndex((s) => s.meaning === "transfer" && (!!s.from_wallet_id !== !!s.wallet_id || (!!s.wallet_id && s.wallet_id === s.from_wallet_id)));
  if (halfMove >= 0) return fail(`Dòng ${halfMove + 1}: chuyển ví cần hai ví khác nhau, hoặc bỏ trống cả hai.`);
  const noKind = splits.findIndex((s) => s.meaning === "buy_asset" && !s.asset_kind);
  if (noKind >= 0) return fail(`Dòng ${noKind + 1} là mua tài sản, cần loại tài sản.`);
  if (diff > 0) return fail(`Còn thiếu ${formatVnd(diff)} so với log.`);
  if (diff < 0) return fail(`Thừa ${formatVnd(-diff)} so với log.`);
  return { ok: true, sum, diff, message: null };
}

/**
 * Toast sau khi gán một log (UC-706 bước 10, DESIGN §4): kết quả kèm hệ quả.
 * `label`: tên danh mục (không có thì tên loại) của dòng duy nhất; `status`: ví của dòng đó sau khi gán, null khi không biết.
 * Lệnh chuyển tiền: xem `ordersLeft`.
 */
export function assignToast(splits: Split[], o: { label: string; status: WalletStatus | null; newOrders: number; pendingOrders: number | null }): string {
  const income = splits.find((s) => s.meaning === "income");
  if (income) {
    const head = `Đã gán và chia ${formatVnd(income.amount)}.`;
    const tail = ordersLeft(o.newOrders, o.pendingOrders);
    return tail ? `${head} ${tail}` : head;
  }
  if (splits.length > 1) return `Đã gán ${splits.length} dòng.`;
  const s = splits[0]!;
  if (s.meaning === "transfer") return `Đã gán chuyển nội bộ ${formatVnd(s.amount)}.`;
  const head = `Đã gán ${formatVnd(s.amount)} ${o.label}.`;
  const tail = walletRemain(o.status);
  return tail ? `${head} ${tail}` : head;
}

/** Toast khi ghi khoản thu mà để chia sau (UC-706 "Gán, để chia sau", UC-705 "Ghi, để chia sau"): nói tiền đang ở đâu, chia ở đâu. */
export function deferredIncomeToast(amount: number): string {
  return `Đã ghi ${formatVnd(amount)} vào ví Thu nhập, chưa chia. Chia ở Giao dịch gần đây › khoản này › Chia.`;
}
