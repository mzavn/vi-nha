# Entity model — balance

Context này sở hữu: **BalanceItem**, **BalanceLot**, **BalanceValue** (`migrations/0031_balance_sheet.sql`, schema v1.31), **ReportClass** (`migrations/0032_report_classes.sql`, v1.32), **IncomePlan**, **IncomePlanLine** (`migrations/0033_income_plans.sql`, v1.33), cùng các **read model** tính ra (không lưu): bảng cân đối tại ngày D, điểm lịch sử, Mốc tự do, Lưu chuyển tiền, Kết quả thu chi, điểm xuất phát Thử số. Mọi số tổng hợp tính theo các [Công thức](README.md#công-thức) của README. `docs/schema.sql` mang đúng cấu trúc này.

Tham chiếu theo tên, không sở hữu: `Account` (`opening_balance`, `opened_at`, `kind = credit`, `deactivated_at` — access / ledger), `Transaction` (`meaning`, `debt_id`, `interest_debt_id`, `receivable_id`, `tenant_id`, `asset_kind`, `month_key` — ledger), `Debt` (`interest_rate_bps`, `term`, `monthly_payment`, `due_day`, `deactivated_at` — debt), `Receivable` (`term`, `deactivated_at` — receivable), sổ người thuê (rental), `Wallet` / `Allocation` (phe ví, luật `percent` — ledger / allocation), `Member` (access), `Config` khoá `fi_*` (access UC-507). Dữ liệu hệ thống ví + danh mục `loan-interest` "Lãi vay" do migration 0031 ghi (`INSERT OR IGNORE`; ví trú ở tài khoản của ví Must đầu tiên có tài khoản — migration — hoặc tài khoản chính lúc thiết lập nhà, `src/services/setup.ts`) thuộc ledger / debt (ADR-94, ADR-106).

---

## BalanceItem — mục tài sản nhập tay (`balance_items`)
| Trường | Ý nghĩa nghiệp vụ / luật |
|---|---|
| `id` | `TEXT PRIMARY KEY`, `[a-z0-9-]{1,40}` (sai → `invalid_id`); không gửi thì sinh từ tên (bỏ dấu, `đ`→`d`, gạch nối — "Vàng" → `vang`); trùng → 409 `duplicate_id` |
| `name` | Bắt buộc (`invalid_input`), cắt ở 60 ký tự |
| `section` | CHECK `A1`,`A2`,`A4`,`A5`,`B1`…`B6` — không có `A3` (API trả `use_receivable_book`) |
| `pyramid` | CHECK `speculative` · `growth` · `income` · `protective` · `fixed` |
| `measure` | CHECK `value` · `units`. Đổi được chỉ khi mục chưa từng có định giá / lô nào (kể cả đã huỷ) — không thì 409 `item_has_values` |
| `unit` | Bắt buộc khi `units` (CHECK `measure <> 'units' OR unit IS NOT NULL`), cắt ở 20 ký tự; mục theo giá trị lưu NULL |
| `liquid` | 0/1, cờ Tiền lỏng. DB mặc định 0; API mặc định 1 khi `section = A1` |
| `investable` | 0/1, cờ Tài sản đầu tư. DB mặc định 1; API mặc định 0 khi `pyramid = fixed` |
| `asset_kind` | NULL hoặc CHECK `gold` · `stock` · `fund` · `re` — gắn với tài sản mua qua app cùng loại: có mục gắn thì `buy_asset` loại đó thôi hiện ở bảng cân đối và ở `assets` của tab Nợ (ADR-99) |
| `cost_basis` | Giá mua cả mục, INTEGER ≥ 0 hoặc NULL — chỉ mục theo giá trị (mục theo lô gửi → `wrong_measure`) |
| `acquired_on` | Ngày mua 'YYYY-MM-DD' ≤ hôm nay hoặc NULL — chỉ mục theo giá trị |
| `take_profit_value` · `stop_loss_value` | Giá chốt lời / cắt lỗ cả mục, > 0 hoặc NULL; có cả hai thì cắt lỗ < chốt lời (CHECK; API `invalid_target`) — chỉ mục theo giá trị |
| `note` | Tuỳ chọn, cắt ở 500 ký tự |
| `sort` | INTEGER, mặc định 100; thứ tự trong mục (rồi tên, `id`) |
| `created_at` | `datetime('now')` UTC |

**Invariants**
- Không trigger: mọi trường sửa được bất cứ lúc nào (`PATCH /v1/balance-items/:id`) trừ `measure` như trên; đổi `section` / `pyramid` / cờ áp cho **cả lịch sử** (ADR-100).
- Xoá (`DELETE`) chỉ khi chưa từng có dòng `balance_values` / `balance_lots` nào (kể cả đã huỷ) — không thì 409 `item_has_values`; có rồi thì bán lô hoặc ghi giá trị 0.
- Không bao giờ sinh giao dịch, đổi ví, số dư tài khoản hay chia tiền (ADR-99).

## BalanceLot — lô của mục theo lô (`balance_lots`)
| Trường | Luật |
|---|---|
| `id` | `INTEGER PRIMARY KEY` |
| `item_id` | `REFERENCES balance_items(id)`; mục phải là `units` (không thì `wrong_measure`) |
| `bought_on` | Ngày mua 'YYYY-MM-DD' ≤ hôm nay, bắt buộc |
| `quantity_milli` | Số lượng phần nghìn đơn vị, CHECK > 0 (1 chỉ = 1000; nửa chỉ = 500). API nhận `quantity` tới 3 chữ số lẻ (`invalid_amount`) |
| `unit_cost` | Giá mua một đơn vị, CHECK ≥ 0 |
| `sold_on` · `sold_unit_price` | NULL cho tới khi bán; ghi một lần, cả hai cùng có (CHECK `(sold_on IS NULL) = (sold_unit_price IS NULL)`), `sold_on ≥ bought_on` (CHECK; API `invalid_sale`), giá ≥ 0 |
| `take_profit_price` · `stop_loss_price` | Mỗi đơn vị, > 0 hoặc NULL; có cả hai thì cắt lỗ < chốt lời (CHECK); sửa tự do khi lô đang giữ (`PATCH /v1/balance-lots/:id`; lô đã bán / huỷ → `invalid_sale`) |
| `note` | Tuỳ chọn, không sửa được |
| `status` | `active` → `void` (một chiều; lần hai → 409 `already_void`) |
| `created_at` · `by_member_id` | Lúc ghi (UTC), người ghi (`REFERENCES members`) |

**Invariants**
- Trigger `trg_balance_lots_guard` (BEFORE UPDATE): không đổi `id`, `item_id`, `bought_on`, `quantity_milli`, `unit_cost`, `note`, `created_at`, `by_member_id`; `sold_*` chỉ đi từ NULL sang có; lô `void` không đổi gì nữa. `trg_balance_lots_no_delete` chặn DELETE. Cả hai ABORT `balance_lot_append_only`.
- Index `idx_balance_lots (item_id) WHERE status='active'`.
- Bán một phần lô: v1 không có — huỷ lô rồi ghi lại hai lô (ADR-103). Lô đã huỷ không có ở ngày nào; lô đã bán có mặt tới trước `sold_on` (Công thức 2).

## BalanceValue — định giá theo ngày (`balance_values`)
| Trường | Luật |
|---|---|
| `id` | `INTEGER PRIMARY KEY` — cùng `as_of` thì `id` lớn nhất thắng |
| `item_id` | `REFERENCES balance_items(id)` |
| `as_of` | 'YYYY-MM-DD' giờ VN, ≤ hôm nay (`future_date`); không gửi thì hôm nay |
| `value` · `unit_price` | CHECK đúng một cột có số, ≥ 0: `value` cho mục theo giá trị, `unit_price` cho mục theo lô (gửi sai cột → `wrong_measure`) |
| `cashflow` | Dòng tiền thật sau thuế, INTEGER ≥ 0, mặc định 0 |
| `cashflow_period` | NULL hoặc `month` · `year`; bắt buộc khi `cashflow > 0` (CHECK; API `missing_period`) |
| `expected_return_bps` | Lợi suất kỳ vọng phần vạn/năm (12% = 1200), NULL hoặc CHECK −10000…100000 (API nhận `expected_return` % −100…1000, sai → `invalid_rate`) |
| `status` | `active` → `void` (một chiều; lần hai → 409 `already_void`) |
| `created_at` · `by_member_id` | Lúc ghi (UTC), người ghi |

**Invariants**
- Chỉ ghi thêm: `trg_balance_values_append_only` chặn mọi UPDATE trừ `status` `active → void`; `trg_balance_values_no_delete` chặn DELETE (ABORT `balance_value_append_only`).
- Index `idx_balance_values (item_id, as_of) WHERE status='active'`.
- Giá hiện tại của mục = dòng `active` mới nhất (Công thức 1, 2); dòng tiền thật và lợi suất kỳ vọng cũng lấy ở dòng đó (Công thức 7, ADR-101).

## ReportClass — phân loại lại một giao dịch (`transaction_report_classes`)
| Trường | Luật |
|---|---|
| `transaction_id` | `INTEGER PRIMARY KEY REFERENCES transactions(id)` — một giao dịch tối đa một phân loại |
| `report_class` | CHECK `operating` · `passive_income` · `investing` · `financing` (khác → `invalid_class`); `passive_income` chỉ cho `income` (`invalid_class`) |
| `updated_at` · `by_member_id` | Lần đặt gần nhất, người đặt |

**Invariants**
- Không phải dòng sổ: đặt / đổi / xoá được (`PUT` / `DELETE /v1/transactions/:id/report-class`, nhật ký `report_class.set|clear`). Chỉ đổi báo cáo — không đổi ví, số dư, chia tiền (ADR-104).
- Chỉ giao dịch có đúng một phía tài khoản (`not_cash_flow`), đang `active` (409 `already_void`), có thật (404).
- Sửa giao dịch (huỷ + ghi mới) chép phân loại sang dòng mới trong cùng batch (ledger [UC-102](../ledger/UC-102-huy-giao-dich.md) AC-19); huỷ hẳn thì phân loại nằm lại với dòng đã huỷ, báo cáo bỏ qua.

## IncomePlan — một bản kế hoạch thu nhập năm (`income_plans`)
| Trường | Luật |
|---|---|
| `id` | `INTEGER PRIMARY KEY` — bản `id` nhỏ nhất của năm = mục tiêu đầu năm, lớn nhất = hiện tại |
| `year` | CHECK 2000…2200; API nhận 2000…năm nay + 1 (`invalid_year`) |
| `household_monthly` | Mục tiêu cả nhà, thu nhập ròng mỗi tháng, CHECK > 0 (API `invalid_plan` khi thiếu / ≤ 0) |
| `created_at` | ISO UTC có mili giây (`strftime('%Y-%m-%dT%H:%M:%fZ')`) |
| `by_member_id` | Người lưu |

**Invariants**: mỗi lần lưu (`PUT /v1/income-plans/:year`) là một bản mới, nhật ký `income_plan.version`; trigger `trg_income_plans_no_update` / `trg_income_plans_no_delete` (ABORT `income_plan_append_only`); index `idx_income_plans_year (year, id)`.

## IncomePlanLine — chia theo người của một bản (`income_plan_lines`)
| Trường | Luật |
|---|---|
| `id` | `INTEGER PRIMARY KEY` |
| `plan_id` | `REFERENCES income_plans(id)` |
| `member_id` | Thành viên (`REFERENCES members`) hoặc NULL = **Chung**; người không tồn tại → `invalid_plan` |
| `name` | Tên dòng ("Lương", "Cho thuê") |
| `monthly_amount` | Số ròng mỗi tháng, CHECK ≥ 0 |
| `sort` | Thứ tự, mặc định 0 |

**Invariants**: thuộc một bản; không có dòng = không chia theo người. Bản đã lưu không đổi nên dòng cũng chỉ ghi thêm — trigger `trg_income_plan_lines_no_update` / `trg_income_plan_lines_no_delete` (thêm khi apply lát 3; proposal chỉ nêu trigger cho `income_plans`). Index `idx_income_plan_lines (plan_id)`. Σ dòng không bắt buộc bằng mục tiêu cả nhà.

## Read model (tính ra, không lưu)
- **BalanceSheet tại ngày D** (`GET /v1/balance-sheet?date=`, `src/domain/balance.ts` › `Sheet`): `date`, `today`, `totalAssets`, `totalLiabilities`, `equity`, `interestPerYear`, `cashflowMonthly` (P), `netCashflowMonthly` (P_ròng); `assets` = các mục A / B có dòng `{ section, total, rows: AssetRow[] }` (`AssetRow`: `key`, `source` `ledger | item`, `itemId`, `name`, `section`, `pyramid`, `liquid`, `investable`, `value`, `pctOfTotal`, `pctOfEquity`, `cashflowMonthly`, `expectedReturnBps`, `valuedOn`); `liabilities` = các nhóm `{ term, group, total, rows: LiabilityRow[] }` (`kind` `debt | credit_card | tenant_prepaid`, `interestRateBps`, `interestPerYear`, `interestThisMonth`, `dueDay`, hai %); `pyramid` năm tầng `{ tier, total, pct }`; `items` = mọi mục nhập tay (`ItemView`: cột của mục + `present`, `value`, `unitPrice`, `priceOn`, `cashflow*`, `expectedReturnBps`, `heldQuantityMilli`, `cost`, `position`, `unrealized`, `unrealizedPct`, `hitTakeProfit`, `hitStopLoss`, `lots: LotView[]`, `values` định giá `active` ≤ D mới nhất trước). `LotView` = cột lô + `held`, `value`, `cost`, `realized`, `position`. `Position` = `pnl`, `pnlPct`, `toTakeProfitPct`, `toStopLossPct`, `status` `take_profit | stop_loss | holding`, `heldDays`, `cagrPct`, `cagrVsExpected` (Công thức 1–7, 17). Mọi thao tác ghi ở [UC-1101](UC-1101-quan-ly-tai-san-lo-gia.md) trả `ItemView` của mục như ở bảng hôm nay.
- **HistoryPoint** (`GET /v1/balance-sheet/history?months=N`): `{ month, date, totalAssets, totalLiabilities, equity, change (vốn chủ so điểm trước; điểm đầu null), pyramid: { tầng: tổng } }` — mỗi điểm bằng đúng bảng của ngày đó ([UC-1102](UC-1102-xem-bang-can-doi.md)).
- **Freedom** (`GET /v1/freedom`, `src/domain/freedom.ts`): thông số dùng (`params`, nguồn chi phí / thu nhập), Mốc an tâm, mốc thu nhập, mốc Tự do (kèm tuổi mục tiêu), `projectionStart` (điểm xuất phát của Thử số) và `incomePlan` năm nay (Công thức 8–13; [UC-1103](UC-1103-moc-tu-do.md), [UC-1104](UC-1104-ke-hoach-thu-nhap.md), [UC-1107](UC-1107-thu-so-du-phong.md)).
- **IncomePlanYear / IncomePlanSummary** (`GET /v1/income-plans/:year`, `GET /v1/income-plans`): bản hiện tại, bản đầu năm, danh sách bản, thực tế, theo người (Công thức 9).
- **CashFlow** (`GET /v1/reports/cash-flow?period=`, `src/domain/reports.ts`): tiền đầu kỳ, tài khoản mở / tắt trong kỳ, ba nhóm với dòng, tiền cuối kỳ, thẻ tín dụng còn nợ, ghi chú lô, từng tháng của kỳ năm (Công thức 14; [UC-1105](UC-1105-luu-chuyen-tien.md)).
- **IncomeStatement** (`GET /v1/reports/income-statement?period=`): Thu nhập, Chi tiêu (Must có dòng con Lãi vay), Để dành, tỷ lệ, chân "không tính", từng tháng của kỳ năm (Công thức 15; [UC-1106](UC-1106-ket-qua-thu-chi.md)).
- **Thử số**: không có entity, không có bảng — tính ở máy từ `projectionStart` (Công thức 16, ADR-105).

## Quan hệ
- `BalanceItem` 1 — n `BalanceValue`; `BalanceItem(units)` 1 — n `BalanceLot`.
- `BalanceItem.asset_kind` n — n (theo loại) `Transaction(buy_asset).asset_kind` — chỉ để ẩn dòng giá mua, không nối từng giao dịch vào lô.
- `Transaction` 1 — 0..1 `ReportClass`.
- `IncomePlan` 1 — n `IncomePlanLine`; `IncomePlanLine` n — 0..1 `Member`.
