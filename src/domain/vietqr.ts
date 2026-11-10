import { bankByCode } from "./banks";

// Chuỗi mã QR chuyển khoản theo chuẩn VietQR (NAPAS, dựa trên EMVCo MPM) — tạo trên máy, không gọi dịch vụ ngoài (ADR-116).

const tlv = (id: string, value: string) => `${id}${String(value.length).padStart(2, "0")}${value}`;

/** CRC-16/CCITT-FALSE (đa thức 0x1021, khởi tạo 0xFFFF) — trường 63 của EMVCo, 4 ký tự hex in hoa. */
export function crc16(s: string): string {
  let crc = 0xffff;
  for (const byte of new TextEncoder().encode(s)) {
    crc ^= byte << 8;
    for (let i = 0; i < 8; i++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

/** Nội dung chuyển khoản app ngân hàng nào cũng nhận: bỏ dấu, chỉ chữ / số / khoảng trắng, tối đa 25 ký tự. */
export function qrMemo(memo: string): string {
  return memo
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[đĐ]/g, (c) => (c === "đ" ? "d" : "D"))
    .replace(/[^A-Za-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 25)
    .trim();
}

export interface VietQrInput {
  /** Mã NAPAS 6 chữ số của ngân hàng nhận (`Bank.napasBin`). */
  bin: string;
  accountNo: string;
  /** Số tiền đồng, nguyên dương. */
  amount: number;
  memo: string;
}

/** Chuỗi QR động (có số tiền) chuyển nhanh tới số tài khoản (dịch vụ QRIBFTTA). */
export function vietQrPayload({ bin, accountNo, amount, memo }: VietQrInput): string {
  const merchant = tlv("00", "A000000727") + tlv("01", tlv("00", bin) + tlv("01", accountNo)) + tlv("02", "QRIBFTTA");
  const text = qrMemo(memo);
  const body =
    tlv("00", "01") +
    tlv("01", "12") +
    tlv("38", merchant) +
    tlv("53", "704") +
    tlv("54", String(Math.round(amount))) +
    tlv("58", "VN") +
    (text ? tlv("62", tlv("08", text)) : "") +
    "6304";
  return body + crc16(body);
}

/** Phần lệnh chuyển tiền cần cho mã QR (`GET /v1/transfer-orders`). */
export interface TransferQrOrder {
  amount: number;
  memo: string;
  to_name: string;
  to_kind: string;
  to_bank: string | null;
  to_account_no: string | null;
  to_sub_account: string | null;
  to_sepay_enabled: number | boolean;
}

/**
 * Mã QR cho một lệnh chuyển (pwa UC-707): `payload` + dòng mô tả, hoặc `reason` vì sao chưa có (`null` = tài khoản không phải
 * ngân hàng, không nói gì). Ngân hàng chỉ nhận qua VA mà tài khoản đã nối SePay → mã hoá số VA để SePay báo được khoản đến.
 */
export function transferQr(o: TransferQrOrder): { payload: string; label: string } | { reason: string | null } {
  if (o.to_kind !== "bank") return { reason: null };
  const bank = bankByCode(o.to_bank);
  if (!bank?.napasBin) return { reason: `Ngân hàng của ${o.to_name} chưa có mã QR.` };
  const va = bank.sepay?.vaRequired && o.to_sepay_enabled && o.to_sub_account ? o.to_sub_account.trim() : null;
  const accountNo = va ?? o.to_account_no?.trim() ?? "";
  if (!accountNo) return { reason: `Chưa có mã QR — thêm số tài khoản cho ${o.to_name} ở Cài đặt › Tài khoản.` };
  if (!/^[A-Za-z0-9]{1,19}$/.test(accountNo)) {
    return { reason: `Chưa có mã QR — số tài khoản của ${o.to_name} không hợp lệ cho mã QR (chỉ chữ và số, tối đa 19 ký tự).` };
  }
  if (qrMemo(o.memo) !== o.memo) return { reason: "Nội dung chuyển khoản có ký tự mã QR không giữ được — chép nội dung để chuyển." };
  return {
    payload: vietQrPayload({ bin: bank.napasBin, accountNo, amount: o.amount, memo: o.memo }),
    label: `${bank.name} · ${va ? `VA ${va}` : accountNo} · ${o.to_name}`,
  };
}
