// Danh mục ngân hàng dùng chung server + PWA. Cột `accounts.bank` (kind bank/credit) chỉ nhận `code` ở đây.
// Khả năng SePay lấy theo tài liệu SePay (developer.sepay.vn › Tài khoản ngân hàng, đọc 1/10/2026):
//   in = SePay báo tiền vào · out = SePay báo tiền ra · vaRequired = chỉ nhận qua tài khoản ảo (VA).
// Ngân hàng không có trong bảng của SePay (`sepay: null`) thì SePay không bắn webhook — chỉ ghi tay.

export interface BankSepay {
  in: boolean;
  out: boolean;
  vaRequired?: boolean;
}

export interface Bank {
  code: string;
  name: string;
  sepay: BankSepay | null;
  /** Mã NAPAS (BIN) cho mã QR VietQR — đối chiếu api.vietqr.io/v2/banks, 10/11/2026. Không có thì không tạo QR. */
  napasBin?: string;
}

export const BANKS: readonly Bank[] = [
  // Có SePay
  { code: "MBBank", napasBin: "970422", name: "MB Bank", sepay: { in: true, out: false } },
  { code: "VietinBank", napasBin: "970415", name: "VietinBank", sepay: { in: true, out: true } },
  { code: "BIDV", napasBin: "970418", name: "BIDV", sepay: { in: true, out: false, vaRequired: true } },
  { code: "ACB", napasBin: "970416", name: "ACB", sepay: { in: true, out: false } },
  { code: "VPBank", napasBin: "970432", name: "VPBank", sepay: { in: true, out: false } },
  { code: "TPBank", napasBin: "970423", name: "TPBank", sepay: { in: true, out: true } },
  { code: "Sacombank", napasBin: "970403", name: "Sacombank", sepay: { in: true, out: true } },
  { code: "MSB", napasBin: "970426", name: "MSB", sepay: { in: true, out: false, vaRequired: true } },
  { code: "OCB", napasBin: "970448", name: "OCB", sepay: { in: true, out: false, vaRequired: true } },
  { code: "KienlongBank", napasBin: "970452", name: "KienlongBank", sepay: { in: true, out: false, vaRequired: true } },
  // Ghi tay
  { code: "Vietcombank", napasBin: "970436", name: "Vietcombank", sepay: null },
  { code: "Techcombank", napasBin: "970407", name: "Techcombank", sepay: null },
  { code: "Agribank", napasBin: "970405", name: "Agribank", sepay: null },
  { code: "VIB", napasBin: "970441", name: "VIB", sepay: null },
  { code: "HDBank", napasBin: "970437", name: "HDBank", sepay: null },
  { code: "SHB", napasBin: "970443", name: "SHB", sepay: null },
  { code: "SeABank", napasBin: "970440", name: "SeABank", sepay: null },
  { code: "Eximbank", napasBin: "970431", name: "Eximbank", sepay: null },
  { code: "LPBank", napasBin: "970449", name: "LPBank", sepay: null },
  { code: "NamABank", napasBin: "970428", name: "Nam A Bank", sepay: null },
  { code: "SCB", napasBin: "970429", name: "SCB", sepay: null },
  { code: "PVcomBank", napasBin: "970412", name: "PVcomBank", sepay: null },
  { code: "Cake", napasBin: "546034", name: "Cake by VPBank", sepay: null },
  { code: "Timo", napasBin: "963388", name: "Timo", sepay: null },
  { code: "Khac", name: "Ngân hàng khác", sepay: null },
];

export const bankByCode = (code: string | null | undefined): Bank | null => BANKS.find((b) => b.code === code) ?? null;
