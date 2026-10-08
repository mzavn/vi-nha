# 🏠 Ví nhà — Hệ thống Profit First cho hộ gia đình

Bộ tài liệu thiết kế cho app quản lý tiền theo **Profit First**. Đấu nối ngân hàng qua SePay,
thông báo Telegram, chạy trên Cloudflare Worker + D1, có MCP cho Claude.

## 📖 Thứ tự đọc

| # | File | Nội dung | Trạng thái |
|---|---|---|---|
| 1 | `profit_first_phuong_phap.md` | **NGUYÊN LÝ** — luật gốc, 4 phe, thuế, ranh giới hộ, cash→assets, ba trục | ✅ v0.5 |
| 2 | `core_design_rules.md` | **LUẬT THI HÀNH** — 6 luật, 8 meaning, chia tiền, kỳ, đối soát, quyết định đã chốt | ✅ v0.6 |
| 3 | `schema.sql` + `seed.sql` | **DATABASE** — D1/SQLite, 13 bảng + 15 view, có test (`npm test`) | ✅ v1.3 |
| 4 | `wireframe.md` | **GIAO DIỆN** — 4 màn, mô tả | ✅ v0.5 |
| 5 | `DESIGN.md` | **HỆ THỐNG THIẾT KẾ** — token, component, pattern, giọng chữ, sàn chất lượng | ✅ v1.0 |
| 6 | `pf-wireframe.html` | **WIREFRAME BẤM ĐƯỢC** — bản dựng tham chiếu của DESIGN.md | ✅ |
| 7 | `setup-zalo-bot.md` | **CÀI ZALO BOT** — tạo bot, luật Cloudflare cho webhook, nối từng người, xử lý khi không chạy | ✅ 3/10/2026 |
| 8 | `cai-bang-ai.md` | **CÀI BẰNG AI** — kịch bản cho agent AI cài Ví nhà lên Cloudflare của người dùng (`npm run setup`, Thiết lập) | ✅ 8/10/2026 |

Lộ trình thi công: `../plans/260921-2228-profit-first-pwa/plan.md` và các `phase-XX` cùng thư mục.

## ⚖️ Luật gốc số 0
> **Tiền là thật, chi là chi thật.** · **Phân bổ trước rồi mới chi.**

## 🔑 Ba câu hỏi giải mọi tình huống lạ
1. Có vượt **ranh giới hộ gia đình** không? *(không → chuyển nội bộ, loại khỏi sổ)*
2. Có phải **tiền thật**? *(không → không vào sổ)*
3. Thuộc phe **khóa / must / nice**?

## 🧭 Dòng thác
```
Thu nhập ─► Tích sản 30% ─► Thuế 10%* ─► Hưởng thụ ─► Must (sàn cứng) ─► Có-thì-tốt (phần dư)
           (cash→assets)   *chỉ khi chưa khấu trừ
BÓP khi thiếu: Có-thì-tốt → Hưởng thụ → Must tới sàn, và KHÔNG BAO GIỜ chạm Tích sản.
Engine thực thi theo ưu tiên: Tích sản → Thuế → sàn Must → Must đủ → Hưởng thụ → Có-thì-tốt.
```

## ✅ Tự kiểm bằng sqlite3
```bash
python3 -c "
import sqlite3; c=sqlite3.connect(':memory:')
c.executescript(open('schema.sql').read()); c.executescript(open('seed.sql').read())
print('OK', len(c.execute(\"select name from sqlite_master where type='view'\").fetchall()), 'view')"
```

## 📝 Lịch sử
- **v0.4 / v1.1** (7/2026) — bản gốc: nguyên lý, luật, schema, 6 wireframe, 2 mockup HTML.
- **v0.5 / v1.2** (20/9/2026) — hợp nhất sổ tay: thuế 10% + quyết toán · Must/Have · **danh mục tách khỏi ví** ·
  **tiền mặt là tài khoản** · **đa tài khoản + khớp cặp transfer nội bộ** · `transfer_orders` · MCP · màn Nhập tay ·
  **một quy ước dấu không ngoại lệ** · **Quỹ an tâm tính động** thay vì hardcode 35tr.
- **v0.6** (21/9/2026) — validate plan: thứ tự ưu tiên của engine tách khỏi thứ tự trình bày · chia ngay từng income ·
  quét cuối tháng chỉ phong bì chung, ví tiêu lố được bù ở lần chia sau · phao theo mức tối thiểu · rà soát giao dịch 02:00 · tuần → tháng đếm số thứ Hai · đối soát hai lớp, `accumulated` chỉ là tham khảo ·
  mật khẩu chung + chọn người. **Schema v1.3** (9 điểm sửa view/seed) đã xong ở phase 01; `migrations/` là bản copy nguyên văn, có test giữ cho khớp.
