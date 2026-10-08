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
}

export const BANKS: readonly Bank[] = [
  // Có SePay
  { code: "MBBank", name: "MB Bank", sepay: { in: true, out: false } },
  { code: "VietinBank", name: "VietinBank", sepay: { in: true, out: true } },
  { code: "BIDV", name: "BIDV", sepay: { in: true, out: false, vaRequired: true } },
  { code: "ACB", name: "ACB", sepay: { in: true, out: false } },
  { code: "VPBank", name: "VPBank", sepay: { in: true, out: false } },
  { code: "TPBank", name: "TPBank", sepay: { in: true, out: true } },
  { code: "Sacombank", name: "Sacombank", sepay: { in: true, out: true } },
  { code: "MSB", name: "MSB", sepay: { in: true, out: false, vaRequired: true } },
  { code: "OCB", name: "OCB", sepay: { in: true, out: false, vaRequired: true } },
  { code: "KienlongBank", name: "KienlongBank", sepay: { in: true, out: false, vaRequired: true } },
  // Ghi tay
  { code: "Vietcombank", name: "Vietcombank", sepay: null },
  { code: "Techcombank", name: "Techcombank", sepay: null },
  { code: "Agribank", name: "Agribank", sepay: null },
  { code: "VIB", name: "VIB", sepay: null },
  { code: "HDBank", name: "HDBank", sepay: null },
  { code: "SHB", name: "SHB", sepay: null },
  { code: "SeABank", name: "SeABank", sepay: null },
  { code: "Eximbank", name: "Eximbank", sepay: null },
  { code: "LPBank", name: "LPBank", sepay: null },
  { code: "NamABank", name: "Nam A Bank", sepay: null },
  { code: "SCB", name: "SCB", sepay: null },
  { code: "PVcomBank", name: "PVcomBank", sepay: null },
  { code: "Cake", name: "Cake by VPBank", sepay: null },
  { code: "Timo", name: "Timo", sepay: null },
  { code: "Khac", name: "Ngân hàng khác", sepay: null },
];

export const bankByCode = (code: string | null | undefined): Bank | null => BANKS.find((b) => b.code === code) ?? null;
