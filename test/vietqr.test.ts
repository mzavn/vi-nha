import { describe, expect, it } from "vitest";
import { BANKS } from "../src/domain/banks";
import { crc16, qrMemo, transferQr, vietQrPayload } from "../src/domain/vietqr";

describe("mã QR chuyển tiền (VietQR)", () => {
  it("UC-707 AC-28: chuỗi VietQR chứa BIN, số tài khoản, số tiền, nội dung và CRC đúng", () => {
    expect(vietQrPayload({ bin: "970422", accountNo: "0123456789", amount: 7_000_000, memo: "PF LJ5685" })).toBe(
      "00020101021238540010A00000072701240006970422011001234567890208QRIBFTTA5303704540770000005802VN62130809PF LJ56856304837F",
    );
  });

  it("UC-707 AC-28: CRC-16/CCITT-FALSE theo giá trị kiểm chuẩn", () => {
    expect(crc16("123456789")).toBe("29B1");
  });

  it("UC-707 AC-28: nội dung bỏ dấu, bỏ ký tự lạ, tối đa 25 ký tự", () => {
    expect(qrMemo("Chuyển tiền Nhà ở — tháng 11!")).toBe("Chuyen tien Nha o thang 1");
    expect(qrMemo("PF LJ5685")).toBe("PF LJ5685");
    expect(qrMemo("Đ đ")).toBe("D d");
  });

  it("UC-1206 AC-6: nội dung QR của việc ngày lương giữ gạch nối của kỳ (\"Tich luy ky 10-11\")", () => {
    expect(qrMemo("Tích luỹ kỳ 10-11")).toBe("Tich luy ky 10-11");
    expect(qrMemo("Học phí kỳ 10-11")).toBe("Hoc phi ky 10-11");
  });

  it("UC-707 AC-28: mọi ngân hàng trừ 'Ngân hàng khác' có mã NAPAS 6 chữ số", () => {
    for (const b of BANKS) {
      if (b.code === "Khac") expect(b.napasBin).toBeUndefined();
      else expect(b.napasBin, b.code).toMatch(/^\d{6}$/);
    }
  });

  const order = { amount: 7_000_000, memo: "PF LJ5685", to_name: "MB tiết kiệm", to_kind: "bank", to_bank: "MBBank", to_account_no: "0123456789", to_sub_account: null, to_sepay_enabled: 0 };

  it("UC-707 AC-28: lệnh tới tài khoản ngân hàng đủ thông tin → chuỗi QR và dòng mô tả", () => {
    expect(transferQr(order)).toEqual({
      payload: "00020101021238540010A00000072701240006970422011001234567890208QRIBFTTA5303704540770000005802VN62130809PF LJ56856304837F",
      label: "MB Bank · 0123456789 · MB tiết kiệm",
    });
  });

  it("UC-707 AC-28: ngân hàng chỉ nhận qua VA đã nối SePay → mã hoá số VA; chưa nối hoặc ngân hàng không bắt VA → số tài khoản", () => {
    const bidv = { ...order, to_name: "BIDV", to_bank: "BIDV", to_account_no: "2222333344", to_sub_account: "96247ABC1", to_sepay_enabled: 1 };
    expect(transferQr(bidv)).toMatchObject({ label: "BIDV · VA 96247ABC1 · BIDV" });
    expect("payload" in transferQr(bidv) && transferQr(bidv)).toMatchObject({ payload: expect.stringContaining("0006970418010996247ABC1") });
    expect(transferQr({ ...bidv, to_sepay_enabled: 0 })).toMatchObject({ label: "BIDV · 2222333344 · BIDV" });
    expect(transferQr({ ...order, to_sub_account: "TKP01", to_sepay_enabled: 1 })).toMatchObject({ label: "MB Bank · 0123456789 · MB tiết kiệm" });
  });

  it("UC-707 AC-28: không đủ điều kiện → lý do (hoặc không gì với tiền mặt / ví / thẻ)", () => {
    expect(transferQr({ ...order, to_kind: "cash", to_bank: null, to_account_no: null })).toEqual({ reason: null });
    expect(transferQr({ ...order, to_kind: "credit" })).toEqual({ reason: null });
    expect(transferQr({ ...order, to_account_no: null })).toEqual({ reason: "Chưa có mã QR — thêm số tài khoản cho MB tiết kiệm ở Cài đặt › Tài khoản." });
    expect(transferQr({ ...order, to_account_no: "01234567890123456789" })).toEqual({ reason: "Chưa có mã QR — số tài khoản của MB tiết kiệm không hợp lệ cho mã QR (chỉ chữ và số, tối đa 19 ký tự)." });
    expect(transferQr({ ...order, to_bank: "Khac" })).toEqual({ reason: "Ngân hàng của MB tiết kiệm chưa có mã QR." });
    expect(transferQr({ ...order, to_bank: null })).toEqual({ reason: "Ngân hàng của MB tiết kiệm chưa có mã QR." });
    expect(transferQr({ ...order, memo: "Chuyển Nhà ở" })).toEqual({ reason: "Nội dung chuyển khoản có ký tự mã QR không giữ được — chép nội dung để chuyển." });
  });
});
