# UC-1101: Thêm mục tài sản, lô, cập nhật giá theo ngày, theo dõi chốt lời / cắt lỗ
- Status: implemented
- BR: BR-15, BR-05
- Decisions: ADR-99 (chỉ tài sản ngoài app mới nhập tay; tiền, nợ, phải thu luôn từ sổ; tài sản mua qua app thôi hiện khi có mục cùng loại), ADR-100 (định giá là dòng chỉ ghi thêm có ngày; số hiện tại là dòng mới nhất), ADR-101 (dòng tiền thật tách lợi suất kỳ vọng, luôn kèm kỳ), ADR-103 (tài sản có số lượng theo dõi theo lô; giá theo ngày thuộc mục; chốt lời / cắt lỗ thuộc lô hoặc mục theo giá trị), ADR-90 (mỗi thao tác một dòng nhật ký)
- Actor: người trong hộ (màn **Tài sản & tự do** › Cân đối — sheet Thêm tài sản, sheet mục, Thêm lô, Bán lô, Cập nhật giá, Giá chốt lời / cắt lỗ, Giá mua & mục tiêu — [pwa/UC-717](../pwa/UC-717-man-tai-san-va-tu-do.md)); Claude qua MCP `record_asset_value` (chỉ cập nhật giá — [mcp/UC-606](../mcp/UC-606-cap-nhat-gia-tai-san-qua-mcp.md))
- Trigger: `POST /v1/balance-items`; `PATCH` / `DELETE /v1/balance-items/:id`; `POST /v1/balance-items/:id/values`; `POST /v1/balance-values/:id/void`; `POST /v1/balance-items/:id/lots`; `PATCH /v1/balance-lots/:id` (chỉ giá chốt lời / cắt lỗ); `POST /v1/balance-lots/:id/sell`; `POST /v1/balance-lots/:id/void`

## History
- v1 (2026-10-08, commit `8cd48b8`): khởi tạo — mục tài sản nhập tay theo giá trị / theo lô (mã mục lưu `A1`…`B6`, không có `A3`), định giá theo ngày chỉ ghi thêm (giá trị hoặc giá một đơn vị, dòng tiền thật kèm kỳ, lợi suất kỳ vọng), lô (thêm, bán một lần cả lô, huỷ), giá chốt lời / cắt lỗ ở lô hoặc mục theo giá trị, lãi / lỗ, khoảng cách, trạng thái, CAGR; nhật ký `balance.*`; không thao tác nào sinh giao dịch (schema v1.31). Lúc apply code chọn thêm ba mã lỗi proposal chưa nêu: đổi cách tính khi đã có định giá / lô → 409 `item_has_values`; huỷ dòng / lô đã huỷ → 409 `already_void`; đặt giá chốt lời / cắt lỗ cho lô đã bán hoặc đã huỷ → 400 `invalid_sale` (change [261008-bang-can-doi](../changes/archive/261008-bang-can-doi/proposal.md))

## Preconditions
- Đã đăng nhập (access UC-501/UC-502); Claude cần quyền Ghi (ADR-98). Cần mạng (không qua hàng đợi offline).
- Mục tài sản chỉ dành cho tài sản **ngoài app** (vàng, chứng khoán, đất…). Tiền ngân hàng / tiền mặt là tài khoản (Cài đặt › Tài khoản), khoản nợ ở sổ nợ, khoản người khác nợ mình ở sổ phải thu — bảng cân đối luôn lấy các số đó từ sổ ([UC-1102](UC-1102-xem-bang-can-doi.md)).

## Main Flow
1. **Thêm tài sản**: người nhập tên, `id` tuỳ chọn (không gửi = mã không dấu của tên, vd "Vàng" → `vang`), **mục** (`A1` tiền và tương đương — vàng bạc, ngoại tệ; `A2` đầu tư tài chính ngắn hạn; `A4` hàng tồn kho; `A5` tài sản ngắn hạn khác; `B1` phải thu dài hạn; `B2` tài sản cố định; `B3` bất động sản đầu tư; `B4` tài sản dở dang; `B5` đầu tư tài chính dài hạn; `B6` tài sản dài hạn khác), **tầng tháp**, cách tính **Theo giá trị** hoặc **Theo lô** (đơn vị bắt buộc, vd "chỉ", "lượng", "cổ phiếu"), cờ **Tiền lỏng** (mặc định bật ở `A1`, còn lại tắt), cờ **Tài sản đầu tư** (mặc định tắt ở tầng cố định, còn lại bật), **Loại tài sản mua qua app** tuỳ chọn (`gold` · `stock` · `fund` · `re`). Sheet nhắc: "Tiền ngân hàng, tiền mặt, khoản nợ, khoản người khác nợ mình lấy từ sổ — không thêm ở đây." Gửi kèm giá trị / giá một đơn vị thì dòng định giá đầu tiên được ghi cùng lúc.
   - Kỹ thuật: `POST /v1/balance-items { name, id?, section, pyramid, measure, unit?, liquid?, investable?, asset_kind?, cost_basis?, acquired_on?, take_profit_value?, stop_loss_value?, note?, sort?, value? | unit_price?, as_of?, cashflow?, cashflow_period?, expected_return? }` → 201 `ItemView` (`createItem`, một batch mục + định giá đầu).
2. **Mục theo lô**: **Thêm lô** — ngày mua, số lượng (tới 3 chữ số lẻ), giá mua một đơn vị, giá chốt lời / cắt lỗ tuỳ chọn; **Bán lô** — ngày bán (từ ngày mua trở đi), giá bán một đơn vị — một lần, cả lô; bán một phần thì huỷ lô rồi ghi lại hai lô.
   - Kỹ thuật: `POST /v1/balance-items/:id/lots { bought_on, quantity, unit_cost, take_profit_price?, stop_loss_price?, note? }` → 201 (`addLot`); `POST /v1/balance-lots/:id/sell { sold_on, sold_unit_price }` (`sellLot`). Không ghi giao dịch nào — tiền bán về tài khoản ghi ở sổ như mọi khoản khác.
3. **Cập nhật giá**: ngày (mặc định hôm nay giờ VN, không sau hôm nay), **giá trị** (mục theo giá trị) hoặc **giá một đơn vị** (mục theo lô — áp cho mọi lô của mục; vàng ghi chú "Giá tiệm mua vào, một chỉ"), **dòng tiền thật** ≥ 0 kèm kỳ **Tháng / Năm** (bắt buộc khi > 0), **lợi suất kỳ vọng** %/năm (tuỳ chọn; chú "Lợi suất kỳ vọng gồm cả tăng giá — không tính là thu nhập"). Ô điền sẵn từ dòng mới nhất. Giá hiện tại = dòng có ngày mới nhất (cùng ngày: dòng ghi sau) — [Công thức 1, 2](README.md#công-thức).
   - Kỹ thuật: `POST /v1/balance-items/:id/values { as_of?, value | unit_price, cashflow?, cashflow_period?, expected_return? }` → 201 (`addValue`; MCP `record_asset_value` gọi cùng hàm).
4. **Sửa mục**: tên, mục, tầng, cờ, loại tài sản mua qua app, ghi chú, thứ tự sửa được bất cứ lúc nào — áp cho cả lịch sử. Cách tính chỉ đổi được khi mục chưa từng có định giá / lô nào. Mục theo giá trị có thêm **giá mua** (tổng vốn), **ngày mua**, **giá chốt lời / cắt lỗ** cả mục (sheet **Giá mua & mục tiêu**; để trống = bỏ).
   - Kỹ thuật: `PATCH /v1/balance-items/:id` (`updateItem`) — trường không gửi giữ nguyên; `null` ở `cost_basis` / `acquired_on` / `take_profit_value` / `stop_loss_value` = bỏ.
5. **Huỷ / xoá** (hai bước ở màn: "Huỷ" → "Huỷ hẳn"): huỷ một dòng định giá hoặc một lô (một chiều). **Xoá mục** chỉ khi mục chưa từng có dòng định giá / lô nào (kể cả đã huỷ); có rồi thì bán lô hoặc ghi giá trị 0 — mục giữ trong lịch sử.
   - Kỹ thuật: `POST /v1/balance-values/:id/void` (`voidValue`), `POST /v1/balance-lots/:id/void` (`voidLot`), `DELETE /v1/balance-items/:id` (`deleteItem`).
6. **Theo dõi khoản đầu tư** ở lô đang giữ: đặt / sửa / xoá **giá chốt lời** và **giá cắt lỗ** (mỗi đơn vị, tuỳ chọn; sheet hai ô, để trống = bỏ). Số mua của lô (ngày, số lượng, giá mua) không sửa được.
   - Kỹ thuật: `PATCH /v1/balance-lots/:id { take_profit_price?, stop_loss_price? }` (`updateLotTargets`) — trường không gửi giữ nguyên, `null` = bỏ.
7. **Xem** (sheet mục, theo [Công thức 17](README.md#công-thức)): mỗi lô / mục theo giá trị có giá mua hiện lãi / lỗ hiện tại (số, %), "còn cách chốt lời X%" / "còn cách cắt lỗ Y%", trạng thái **Đã chạm chốt lời** (xanh) / **Đã chạm cắt lỗ** (đỏ) / **Đang giữ**, **CAGR** từ ngày mua (giữ ≥ 365 ngày) cạnh lợi suất kỳ vọng ("cao / thấp hơn kỳ vọng N điểm"); giữ < 365 ngày → "+X% từ ngày mua (chưa đủ 1 năm)". Giá mua 0 hoặc giá hiện tại 0 → các % đó "—". Mục theo lô có hàng tổng "Vốn … · lãi chưa chốt … · N lô đã chạm chốt lời / cắt lỗ", nhóm **Đã bán (N)** (lãi / lỗ đã chốt, không trạng thái), lịch sử giá dưới các lô; mục theo giá trị có lịch sử định giá (ngày · giá trị · dòng tiền · kỳ vọng). Mọi thao tác ghi trả về mục như ở bảng hôm nay; bảng, tháp đọc lại.
8. Mỗi thao tác ghi một dòng nhật ký (ADR-90): `balance.item.create|update|delete` (đích `balance_item:<id>`; `update` ghi danh sách trường đã gửi), `balance.value.add` (`balance_item:<id>`), `balance.value.void` (`balance_value:<id>`), `balance.lot.add` (`balance_item:<id>`), `balance.lot.sell|void|targets` (`balance_lot:<id>`). MCP `record_asset_value` ghi `balance.value.add` với `via = mcp`.

## Alternative Flows
- 1a. Mục chưa có định giá / lô nào: chưa có mặt ở bảng cân đối (Công thức 1, 2) nhưng vẫn có trong danh sách mục; mục có giá trị 0 không hiện ở A / B.
- 2a. Mục theo lô chưa có giá nào: mỗi lô tính theo giá mua của nó (AC-3).
- 3a. Ghi giá cho ngày cũ hơn dòng mới nhất: dòng được lưu (lịch sử), giá hiện tại không đổi (AC-3).
- 4a. Gắn **Loại tài sản mua qua app** (vd `gold`): dòng "Vàng mua qua app (giá mua)" thôi hiện ở bảng cân đối và ở `assets` của tab Nợ; tab Tích sản vẫn theo giá mua ([UC-1102](UC-1102-xem-bang-can-doi.md) AC-4, receivable [UC-1005](../receivable/UC-1005-xem-buc-tranh-tien-that.md) AC-8).

## Exceptions
- E1. Mục `A3` (phải thu ngắn hạn) → 400 `use_receivable_book` "Khoản người khác nợ mình ghi ở sổ phải thu (tab Nợ)."; mục / tầng / cách tính / kỳ / loại lạ, thiếu tên, mục theo lô thiếu đơn vị, cờ không phải true / false, ngày sai dạng → 400 `invalid_input`.
- E2. Ngày (`as_of`, `bought_on`, `sold_on`, `acquired_on`) sau hôm nay → 400 `future_date`.
- E3. Giá trị / giá / giá mua / giá bán âm, lẻ, > 10^12 hoặc thiếu; số lượng ≤ 0 hoặc quá 3 chữ số lẻ → 400 `invalid_amount`.
- E4. Dòng tiền > 0 không kèm kỳ → 400 `missing_period`.
- E5. Lợi suất kỳ vọng ngoài −100…1000 %/năm → 400 `invalid_rate`.
- E6. Ghi giá trị cho mục theo lô, giá một đơn vị cho mục theo giá trị, thêm lô cho mục theo giá trị, hoặc đặt giá mua / ngày mua / giá chốt lời / cắt lỗ cấp mục cho mục theo lô → 400 `wrong_measure`.
- E7. Bán lô đã bán hoặc đã huỷ, ngày bán trước ngày mua → 400 `invalid_sale`; đặt giá chốt lời / cắt lỗ cho lô đã bán hoặc đã huỷ → 400 `invalid_sale` (mã code chọn khi apply).
- E8. Giá chốt lời / cắt lỗ ≤ 0, hoặc có cả hai mà cắt lỗ ≥ chốt lời → 400 `invalid_target`.
- E9. Mã sai dạng → 400 `invalid_id`; mã đã có → 409 `duplicate_id`.
- E10. Xoá mục đã từng có định giá / lô → 409 `item_has_values` "… bán lô hoặc ghi giá trị 0 thay vì xoá."; đổi cách tính khi đã có định giá / lô → 409 `item_has_values` (mã code chọn khi apply).
- E11. Huỷ dòng định giá / lô đã huỷ → 409 `already_void` (mã code chọn khi apply).
- E12. Mục / lô / dòng định giá không có → 404 `not_found`.
- Mọi lỗi: không ghi gì, không có dòng nhật ký.

## Postconditions
- Chỉ bảng `balance_items`, `balance_lots`, `balance_values` và `audit_log` đổi. Không giao dịch, ví, số dư tài khoản, "còn để chi", Tiền chi được, Tích sản, chia tiền hay thông báo nào đổi (ADR-99).

## Acceptance Criteria

### AC-1: Thêm mục theo giá trị
- Given chưa có mục nào
- When thêm "Đất nền" mục `B3`, tầng tăng trưởng, theo giá trị, giá trị 600.000.000 ngày 2026-10-01
- Then `id = "dat-nen"`, cờ tiền lỏng tắt, tài sản đầu tư bật, một dòng định giá; bảng cân đối có "Đất nền 600.000.000 ₫" ở `B3`
- Tests: [`test/balance.test.ts`](../../test/balance.test.ts) › "UC-1101 thêm mục tài sản, lô, giá theo ngày, chốt lời / cắt lỗ › UC-1101 AC-1: thêm Đất nền B3 theo giá trị → id dat-nen, tiền lỏng tắt, tài sản đầu tư bật, một dòng định giá, có ở B3"; [`web/src/lib/net-worth.test.ts`](../../web/src/lib/net-worth.test.ts) › "ô nhập: mục, định giá, lô › UC-1101 AC-1: thêm Đất nền B3 tăng trưởng theo giá trị — cờ mặc định tiền lỏng tắt, tài sản đầu tư bật; A1 bật tiền lỏng; tầng cố định tắt tài sản đầu tư; không có A3"

### AC-2: Mục theo lô — giá trị, lãi / lỗ từng lô và tổng
- Given "Vàng" (`vang`) mục `A1`, tầng phòng vệ, theo lô đơn vị "chỉ"; lô 1 mua 2026-03-10 20 chỉ giá 5.000.000 ₫/chỉ, lô 2 mua 2026-09-01 4 chỉ giá 6.000.000 ₫/chỉ; giá 5.000.000 ngày 2026-10-01 rồi 5.250.000 ngày 2026-11-01
- When xem hôm nay 2026-11-15
- Then cờ tiền lỏng bật (mặc định `A1`); giá trị 126.000.000 ₫ (24 chỉ × 5.250.000); lô 1 lãi +5.000.000 ₫ (+5,0%), lô 2 lỗ −3.000.000 ₫ (−12,5%); tổng vốn 124.000.000 ₫, lãi chưa chốt +2.000.000 ₫ (+1,6%)
- Tests: [`test/balance.test.ts`](../../test/balance.test.ts) › "UC-1101 thêm mục tài sản, lô, giá theo ngày, chốt lời / cắt lỗ › UC-1101 AC-2 (lô): Vàng 24 chỉ × 5.250.000 = 126.000.000; lô 1 +5.000.000 (+5,0%), lô 2 −3.000.000 (−12,5%); vốn 124.000.000, lãi chưa chốt +2.000.000 (+1,6%)"; [`web/src/lib/net-worth.test.ts`](../../web/src/lib/net-worth.test.ts) › "lô, chốt lời / cắt lỗ, CAGR › UC-1101 AC-2: mục Vàng theo lô — \"24 chỉ · lãi +2.000.000 ₫ (+1,6%)\"; lô 1 \"Mua 10/3/2026 · 20 chỉ × 5.000.000 ₫\"; tổng \"Vốn 124.000.000 ₫ · lãi chưa chốt +2.000.000 ₫ (+1,6%)\"" · "ô nhập: mục, định giá, lô › UC-1101 AC-2, AC-4: thêm lô số lượng tới 3 chữ số lẻ; bán lô không trước ngày mua"

### AC-3: Giá theo ngày — dòng mới nhất thắng, huỷ thì về dòng trước
- Given như AC-2
- When ghi giá 5.200.000 ngày 2026-10-20
- Then giá hiện tại vẫn 5.250.000 (dòng có ngày mới nhất; cùng ngày thì dòng ghi sau); huỷ dòng 2026-11-01 → giá hiện tại 5.200.000, giá trị 124.800.000 ₫; mục chưa có giá nào thì mỗi lô tính theo giá mua của nó
- Tests: [`test/balance.test.ts`](../../test/balance.test.ts) › "UC-1101 thêm mục tài sản, lô, giá theo ngày, chốt lời / cắt lỗ › UC-1101 AC-3 (giá theo ngày): ghi giá ngày cũ hơn không thắng; huỷ dòng mới nhất → giá trước đó; chưa có giá → lô theo giá mua"

### AC-4: Bán lô — một lần, cả lô, không có giao dịch
- Given như AC-2
- When bán lô 2 ngày 2026-11-10 giá 5.300.000 ₫/chỉ
- Then giá trị hiện tại 105.000.000 ₫ (lô 1); nhóm "Đã bán" có lô 2, lãi / lỗ đã chốt −2.800.000 ₫; điểm lịch sử 31/10 vẫn tính cả hai lô; bán lần nữa → 400 `invalid_sale`; không có giao dịch nào được ghi — tiền bán về tài khoản ghi ở sổ như mọi khoản khác
- Tests: [`test/balance.test.ts`](../../test/balance.test.ts) › "UC-1101 thêm mục tài sản, lô, giá theo ngày, chốt lời / cắt lỗ › UC-1101 AC-4 (bán lô): bán lô 2 → còn 105.000.000, lãi lỗ đã chốt −2.800.000; điểm 31/10 vẫn tính hai lô; bán lần nữa → invalid_sale; không có giao dịch"; [`web/src/lib/net-worth.test.ts`](../../web/src/lib/net-worth.test.ts) › "lô, chốt lời / cắt lỗ, CAGR › UC-1101 AC-4: lô đã bán — \"Bán 10/11/2026 × 5.300.000 ₫ · đã chốt −2.800.000 ₫\"" · "ô nhập: mục, định giá, lô › UC-1101 AC-2, AC-4: thêm lô số lượng tới 3 chữ số lẻ; bán lô không trước ngày mua"

### AC-5: Dòng tiền thật kèm kỳ, tách lợi suất kỳ vọng
- Given "Chứng khoán" theo giá trị
- When ghi giá trị 50.000.000, dòng tiền 3.000.000 kỳ **Năm**, lợi suất kỳ vọng 12%
- Then bảng hiện "dòng tiền 250.000 ₫/tháng (3.000.000 ₫/năm) · kỳ vọng 12%/năm"; dòng tiền 3.000.000 không kèm kỳ → 400 `missing_period`
- Tests: [`test/balance.test.ts`](../../test/balance.test.ts) › "UC-1101 thêm mục tài sản, lô, giá theo ngày, chốt lời / cắt lỗ › UC-1101 AC-5: dòng tiền 3.000.000 kỳ Năm → 250.000/tháng, kỳ vọng 12%/năm; dòng tiền không kèm kỳ → missing_period"; [`web/src/lib/net-worth.test.ts`](../../web/src/lib/net-worth.test.ts) › "bảng cân đối: số và chữ › UC-1101 AC-5: dòng tiền 3.000.000 kỳ Năm, kỳ vọng 12% → \"dòng tiền 250.000 ₫/tháng (3.000.000 ₫/năm) · kỳ vọng 12%/năm\"" · "ô nhập: mục, định giá, lô › UC-1101 AC-5, AC-7: định giá — dòng tiền > 0 luôn kèm kỳ; ngày sau hôm nay chặn tại máy; mục theo lô gửi `unit_price`"

### AC-6: Màn tài sản không đụng sổ thu chi; mỗi thao tác một dòng nhật ký
- Given bất kỳ
- When thêm / định giá / thêm, bán, huỷ lô / đặt giá chốt lời, cắt lỗ / sửa / xoá mục
- Then không có giao dịch, ví, số dư tài khoản, "còn để chi", Tiền chi được hay Tích sản nào đổi (snapshot trước = sau) — vàng là tiền lỏng ở màn tài sản nhưng không bao giờ vào tiền chi tiêu; mỗi thao tác có đúng một dòng nhật ký (ADR-90) với hành động `balance.item.create|update|delete`, `balance.value.add|void`, `balance.lot.add|sell|void|targets`
- Tests: [`test/balance.test.ts`](../../test/balance.test.ts) › "UC-1101 thêm mục tài sản, lô, giá theo ngày, chốt lời / cắt lỗ › UC-1101 AC-6: mọi thao tác ở màn tài sản không đổi giao dịch, ví, số dư, còn để chi, Tích sản; mỗi thao tác một dòng nhật ký"

### AC-7: Không thêm phải thu tay, không ghi ngày tương lai, không xoá mục đã có dòng
- Given mục `A3`, hoặc ngày 2026-12-01 khi hôm nay 2026-11-15, hoặc xoá "Vàng" đã có lô
- When thêm / ghi / xoá
- Then 400 `use_receivable_book` / 400 `future_date` / 409 `item_has_values`, không ghi gì; mục mới chưa có dòng nào xoá được
- Tests: [`test/balance.test.ts`](../../test/balance.test.ts) › "UC-1101 thêm mục tài sản, lô, giá theo ngày, chốt lời / cắt lỗ › UC-1101 AC-7: mục A3 → use_receivable_book; ngày sau hôm nay → future_date; xoá Vàng đã có lô → 409 item_has_values; mục mới chưa có dòng xoá được"; [`web/src/lib/net-worth.test.ts`](../../web/src/lib/net-worth.test.ts) › "ô nhập: mục, định giá, lô › UC-1101 AC-5, AC-7: định giá — dòng tiền > 0 luôn kèm kỳ; ngày sau hôm nay chặn tại máy; mục theo lô gửi `unit_price`"

### AC-8: Chốt lời / cắt lỗ theo lô
- Given như AC-2 (giá hiện tại 5.250.000, hôm nay 2026-11-15); lô 1 chốt lời 5.500.000, cắt lỗ 4.800.000; lô 2 cắt lỗ 5.400.000, không chốt lời
- When xem
- Then lô 1 "+5.000.000 ₫ (+5,0%) · còn cách chốt lời 4,7% · còn cách cắt lỗ 8,5% · Đang giữ · +5,0% từ ngày mua (chưa đủ 1 năm)"; lô 2 "−3.000.000 ₫ (−12,5%) · Đã chạm cắt lỗ (−2,8%)"; dòng tổng "1 lô đã chạm cắt lỗ"; `PATCH` lô 1 cắt lỗ 5.600.000 (≥ chốt lời) → 400 `invalid_target`; không có giao dịch hay thông báo nào
- Tests: [`test/balance.test.ts`](../../test/balance.test.ts) › "UC-1101 thêm mục tài sản, lô, giá theo ngày, chốt lời / cắt lỗ › UC-1101 AC-8 (chốt lời / cắt lỗ theo lô): lô 1 còn cách chốt lời 4,7%, cắt lỗ 8,5%, Đang giữ; lô 2 Đã chạm cắt lỗ (−2,8%); cắt lỗ ≥ chốt lời → invalid_target"; [`web/src/lib/net-worth.test.ts`](../../web/src/lib/net-worth.test.ts) › "lô, chốt lời / cắt lỗ, CAGR › UC-1101 AC-8: lô 1 đang giữ, còn cách chốt lời 4,7%, cắt lỗ 8,5%, chưa đủ 1 năm; lô 2 đã chạm cắt lỗ (−2,8%); dòng tổng \"1 lô đã chạm cắt lỗ\""

### AC-9: Mục theo giá trị — lãi / lỗ, khoảng cách, CAGR
- Given "Đất nền" như AC-1, giá trị hiện tại 600.000.000, giá mua 400.000.000 ngày mua 2023-11-15, chốt lời 800.000.000, lợi suất kỳ vọng 12%
- When xem hôm nay 2026-11-15
- Then "+200.000.000 ₫ (+50,0%) · còn cách chốt lời 33,3% · Đang giữ · CAGR 14,4%/năm — cao hơn kỳ vọng 2,4 điểm" (1.096 ngày); xoá giá chốt lời → không còn dòng khoảng cách, trạng thái "Đang giữ"; giá mua 0 → % lãi / lỗ "—", CAGR "—"
- Tests: [`test/balance.test.ts`](../../test/balance.test.ts) › "UC-1101 thêm mục tài sản, lô, giá theo ngày, chốt lời / cắt lỗ › UC-1101 AC-9 (mục theo giá trị, CAGR): +200.000.000 (+50,0%), còn cách chốt lời 33,3%, CAGR 14,4%/năm, cao hơn kỳ vọng 2,4 điểm; bỏ chốt lời; giá mua 0 → —"; [`web/src/lib/net-worth.test.ts`](../../web/src/lib/net-worth.test.ts) › "lô, chốt lời / cắt lỗ, CAGR › UC-1101 AC-9: Đất nền — \"+200.000.000 ₫ (+50,0%) · còn cách chốt lời 33,3% · Đang giữ · CAGR 14,4%/năm — cao hơn kỳ vọng 2,4 điểm\"; bỏ chốt lời → không còn khoảng cách; giá mua 0 → \"—\""

## Dependencies
- Upstream UC: access UC-501/UC-502 (đăng nhập); access [UC-507](../access/UC-507-cau-hinh-thanh-vien-ma-tham-so.md) (`fi_inflation_bps` cho dòng tiền ròng ở bảng).
- Downstream UC: [UC-1102](UC-1102-xem-bang-can-doi.md) (bảng cân đối, tháp, lịch sử), [UC-1103](UC-1103-moc-tu-do.md) (tiền lỏng, tài sản đầu tư, dòng tiền ròng), [UC-1105](UC-1105-luu-chuyen-tien.md) (ghi chú lô ở Đầu tư), [UC-1107](UC-1107-thu-so-du-phong.md) (lợi suất kỳ vọng mặc định), receivable [UC-1005](../receivable/UC-1005-xem-buc-tranh-tien-that.md) (`balanceItems`), pwa [UC-717](../pwa/UC-717-man-tai-san-va-tu-do.md), mcp [UC-606](../mcp/UC-606-cap-nhat-gia-tai-san-qua-mcp.md).
- External Systems: không (giá thị trường tự động để sau).

## Traceability
- Code: `src/services/balance.ts` › `createItem`, `updateItem`, `deleteItem`, `addValue`, `voidValue`, `addLot`, `updateLotTargets`, `sellLot`, `voidLot`, `getItem`, `valueRow`, `targets`; `src/domain/balance.ts` › `itemAt`, `position` (Công thức 1, 2, 7, 17); `src/routes/balance.ts` › `balanceRoutes` (nhật ký `recordChange`); MCP `record_asset_value` ở `src/mcp/tools.ts`
- API / sự kiện: `POST /v1/balance-items`, `PATCH` / `DELETE /v1/balance-items/:id`, `POST /v1/balance-items/:id/values`, `POST /v1/balance-values/:id/void`, `POST /v1/balance-items/:id/lots`, `PATCH /v1/balance-lots/:id`, `POST /v1/balance-lots/:id/sell`, `POST /v1/balance-lots/:id/void` (lỗi `use_receivable_book`, `future_date`, `invalid_amount`, `missing_period`, `invalid_rate`, `wrong_measure`, `invalid_sale`, `invalid_target`, `invalid_id`, `invalid_input`, `duplicate_id`, `item_has_values`, `already_void`, `not_found`); nhật ký `balance.item.create|update|delete`, `balance.value.add|void`, `balance.lot.add|sell|void|targets`
- Dữ liệu: migration `migrations/0031_balance_sheet.sql` — bảng `balance_items`, `balance_lots`, `balance_values`; trigger `trg_balance_lots_guard`, `trg_balance_lots_no_delete`, `trg_balance_values_append_only`, `trg_balance_values_no_delete`; index `idx_balance_lots`, `idx_balance_values` ([entities.md](entities.md))
- PWA: `web/src/screens/net-worth.tsx` (sheet mục, lô, định giá, chốt lời / cắt lỗ); `web/src/lib/net-worth.ts` › `positionText`, `statusLabel`, `growthText`, `lotsSummary`, `lotsTotalText`, `lotSub`, `targetsPayload`, `itemTargetsPayload`
