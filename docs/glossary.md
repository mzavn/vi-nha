# Bảng tra từ: giao diện ↔ code

Giao diện, tin nhắn, chú thích, tên test, specs viết **tiếng Việt**. Tên biến / hàm / kiểu / file, giá trị lưu DB, trường và đường dẫn API, địa chỉ màn PWA, tool MCP viết **tiếng Anh** (luật ở `AGENTS.md` §5, change [`261007-doi-ten-tieng-anh`](../specs/changes/archive/261007-doi-ten-tieng-anh/proposal.md)).

Giá trị lưu DB / API dùng `snake_case`; trường JSON và tên TypeScript dùng `camelCase` / `PascalCase` của cùng chữ.

## Phe (`wallets.tier`)

| Giao diện | Code | Nghĩa |
|---|---|---|
| Thu nhập (ví giữ) | `holding` | tiền về chờ chia; cũng là ví quỹ giữ riêng (`isReserve`) |
| Tích sản | `wealth_building` | phần khoá trước để tích luỹ tài sản — tương ứng tài khoản *Profit* trong sách Profit First |
| Thuế | `tax` | dự phòng thuế |
| Hưởng thụ | `nice` | chơi, mua sắm, du lịch; bị bóp đầu tiên |
| Vận hành | `must` | chi phí sống; nhóm `must` (sàn cứng) và `have` (Có thì tốt, nhận phần dư) |

## Tài khoản giữ tiền Tích sản (`accounts.role`)

| Giao diện | Code |
|---|---|
| Heo đất | `piggy_bank` |
| Phao dự phòng | `buffer` |
| Sổ tiết kiệm | `term_deposit` |

## Khác

| Giao diện | Code |
|---|---|
| Quỹ an tâm (số tháng × chi Must trung bình) | `safetyFund`; số tháng `config.safety_fund_months`; view `v_safety_fund` |
| Tích sản (chi tiết, tab Tích sản) | `GET /v1/wealth-building`, view `v_wealth_building` |
| Ví | wallet |
| Tài khoản | account |
| Danh mục | category |
| Dòng thác | allocation (rót tiền theo phe) |
| Chưa gán | pending log (`bank_logs.status = 'pending'`) |
| Đối soát | reconciliation |
| Nghĩa giao dịch | `meaning`: `spend`, `income`, `refund`, `transfer`, `buy_asset`, `lend`, `collect` |

## Địa chỉ màn PWA

| Màn | Hash |
|---|---|
| Hôm nay | `#today` |
| Nhập | `#entry` |
| Gán | `#assign` |
| Ví & quỹ | `#wallets` (tab con: `budget`, `wealth-building`, `accounts`, `analysis`, `transfers`, `tenants`, `debts`) |
| Sổ giao dịch | `#ledger` |
| Cài đặt | `#settings` |

## Mã hệ thống code đọc thẳng

Mọi mã khác (ví, tài khoản, danh mục, thành viên…) là dữ liệu của từng nhà, sinh từ tên người dùng gõ — code không khoá theo (ADR-94). Icon danh mục nằm ở cột `categories.icon`.

| Giao diện | Mã |
|---|---|
| Kết nối SePay mặc định | `default` |
| Danh mục Trả nợ | `debt-payment` |
| Danh mục Cho vay / trả hộ | `lending` |
| Nguồn thu cho thuê (mặc định) | giá trị `config.rental_income_stream_id`; hộ mẫu dùng `rental` |

Hộ mẫu (`docs/seed.sql`): thành viên `husband` / `wife`; ví `income`, `wealth-building`, `tax`, `nice-to-have`…; danh mục `groceries`, `fuel-parking`…
