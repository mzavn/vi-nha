// Mã QR chuyển khoản VietQR (ADR-116): vẽ trên máy, nền trắng cố định để quét được cả khi app ở nền tối. Dùng cho việc ngày
// lương ở Hôm nay (pocket UC-1206 bước 10) và bản tính người thuê (pwa UC-713).

import { useMemo } from "preact/hooks";
import { encode } from "uqr";

/** Ảnh PNG của mã QR (nền trắng, mức sửa lỗi M, viền 4 ô) — PNG để nhấn giữ lưu được vào thư viện ảnh cho app ngân hàng quét. */
export function qrPng(payload: string): string {
  const { data, size } = encode(payload, { ecc: "M", border: 4 });
  const scale = 8;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size * scale;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#000";
  data.forEach((row, y) => row.forEach((on, x) => on && ctx.fillRect(x * scale, y * scale, scale, scale)));
  return canvas.toDataURL("image/png");
}

/** Ảnh QR dạng tệp PNG để chia sẻ kèm tin (Web Share); không vẽ được thì null. */
export function qrPngFile(payload: string, name: string): File | null {
  const url = qrPng(payload);
  const b64 = url.split(",")[1];
  if (!b64 || typeof File === "undefined") return null;
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new File([bytes], name, { type: "image/png" });
}

export function TransferQrBlock({ payload, label, memo }: { payload: string; label: string; memo: string }) {
  const src = useMemo(() => qrPng(payload), [payload]);
  return (
    <div class="qr-block">
      <img src={src} alt={`Mã QR chuyển tiền: ${label}`} width={200} height={200} />
      <div>
        <div style={{ fontWeight: 500 }}>{label}</div>
        <div class="sub-line" style={{ marginTop: "4px" }}>
          Mở app ngân hàng › Quét QR. Đang dùng điện thoại: nhấn giữ để lưu ảnh (hoặc chụp màn hình) rồi chọn ảnh trong mục quét QR.
          Xem đúng tên người nhận và nội dung có <strong>{memo}</strong> trước khi chuyển.
        </div>
      </div>
    </div>
  );
}
