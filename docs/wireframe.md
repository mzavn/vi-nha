# Giao diện — 4 màn (v0.5)

Gộp từ `wireframe/` 6 file bản 7/2026 + mockup `vi_finance_mvp.html`, bổ sung màn Nhập tay
và 3 cột dự kiến/thực tế/còn lại của sổ tay 9/2026.

```
┌──────────┬──────────┬──────────┬──────────┐
│ 🏠 HÔM   │ ＋ NHẬP  │ 📥 GÁN   │ 💼 VÍ &  │
│    NAY   │          │          │    QUỸ   │
└──────────┴──────────┴──────────┴──────────┘
```

---

## 1 · HÔM NAY — mở app là thấy câu trả lời

```
╔════════════════════════════════════╗
║  CÒN ĐỂ CHI TUẦN NÀY               ║
║        3.250.000 ₫                 ║   ← số to nhất màn
║  còn 4 ngày · T38 (14–20/9)        ║
╚════════════════════════════════════╝
 📥 5 chưa gán      ❌ lệch 120k (VCB)
 🔁 2 lệnh chuyển tiền chưa làm

 🌱 Tích sản   9.000.000   ████████░░ 30%
     cash 4.0tr → assets 5.0tr · phao 0,4/6 tháng
 🧾 Thuế         0          (lương đã khấu trừ)
 🎉 Hưởng thụ  2.500.000 / 3.280.000
 🏠 Must       11.750.000 / 12.000.000
 🎁 Có thì tốt  1.200.000 / 4.000.000

 🎯 Du lịch 45% · Về quê 12% · Phao 0,4/6 tháng
```
Chạm một phe → mở màn Ví & Quỹ đã lọc sẵn phe đó.

---

## 2 · NHẬP — màn dùng nhiều nhất, phải nhanh nhất

Mục tiêu: **3 chạm, dưới 5 giây**, một tay, khi đang đứng ở quán.

```
┌────────────────────────────┐
│        250.000 ₫           │  ← bàn phím số bật SẴN khi mở
│   [50k] [100k] [200k]      │
├────────────────────────────┤
│ ⛽    🍜    ☕    🚕   🛒  🏥 │  ← 6 danh mục hay dùng nhất (30 ngày)
│ xăng  chợ  cà phê grab mua y tế│
│              [ tất cả ▾ ]  │
├────────────────────────────┤
│ ví: Đi lại ▾   từ: Tiền mặt ▾│  ← tự điền từ danh mục, sửa được
│ ghi chú… · hôm nay ▾        │
│        [ LƯU ]              │
└────────────────────────────┘
        ↓
  ✓ Đã ghi. Đi lại còn 950.000 tuần này
```
- Nút `+` nổi ở mọi màn.
- "Loại khác": thu nhập ngoài · hoàn tiền · mua tài sản · cho vay · chuyển nội bộ.
- **Đếm ví** (chủ nhật): nhập số tiền mặt thật → hiện chênh lệch với sổ → xác nhận sinh `adjust`.

---

## 3 · GÁN — nơi giải mọi edge case

```
📥 CẦN GÁN (5)
┌──────────────────────────────────────┐
│ 14:22  − 250.000   VCB               │
│ "CHUYEN TIEN EAN"        gợi ý: Ăn ▸ │
├──────────────────────────────────────┤
│ 09:10  + 30.000.000  VCB       ⚠ vào │
│ "LUONG THANG 9"       → CHIA TIỀN ▸  │
├──────────────────────────────────────┤
│ 20/9   − 2.000.000  VCB              │
│ rút ATM?          → Tiền mặt ▸       │
└──────────────────────────────────────┘
```
Chạm → sheet gán:
- chọn `meaning` → ví → **danh mục** → tài khoản
- **tách nhiều dòng** (tổng phải khớp `log.amount`, app chặn nếu lệch)
- ☑ "Tạo rule từ nội dung này" → lần sau tự gán
- Tiền vào chọn `income` → hỏi **taxable?** → hiện **preview waterfall** → xác nhận chia

> Tiền vào không bao giờ tự gán, trừ khớp mẫu lương. Log đã ghép cặp transfer nội bộ thì không hiện ở đây.

---

## 4 · VÍ & QUỸ

```
[ tuần | tháng ]            tháng 9/2026
ví              dự kiến    thực tế   còn lại
─────────────────────────────────────────────
🏠 Nhà ở        8.000.000  8.000.000        0
🍚 Ăn uống      2.500.000  2.310.000   190.000
🚌 Đi lại       1.200.000    250.000   950.000
💡 Điện nước      300.000    280.000    20.000
🎁 Có thì tốt   4.000.000  4.150.000  −150.000  ← đỏ
```
Tab con:
- **Tích sản** — cash / assets, tiến độ Quỹ an tâm (N tháng × chi Must TB, N ở config), danh sách `buy_asset`;
  phao đầy → nút "Mua tài sản" nổi lên.
- **Tài khoản** — mọi TK (bank · tiền mặt · ví điện tử): số dư sổ vs ngân hàng, lệch tô đỏ.
- **Phân tích** — chi theo **danh mục** tháng này vs tháng trước.
- **Lệnh chuyển tiền** — checklist pending, nút copy số tiền + nội dung CK.

---

## Quy ước hiển thị
- Tiền: `1.250.000 ₫`. Tuần: `T38 (14–20/9)`. Âm: đỏ, có dấu `−`.
- Ví `private` của người khác: hiện tên, ẩn số.
- Mọi số đều **tính ra từ view**, không có số nào nhập tay vào màn hình.
