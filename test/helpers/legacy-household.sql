-- Hộ mẫu dữ liệu cũ (v1.37, có ví) cho test đường nâng cấp lên v2 — chạy sau baseline 0030 + 0031…0037, trước 0038.
-- Sinh một lần từ hộ mẫu của chuỗi migration riêng (0001…0037, gồm hộ mẫu 0002) để test chạy được cả ở bản công khai
-- (chỉ có baseline). Chỉ có dòng khác với DB trống; ngày mở sổ, hạn mục tiêu, giờ thiết lập theo đồng hồ thật như 0002 /
-- 0030. Khớp từng dòng được kiểm ở test/migrations/legacy-household.test.ts (chỉ repo gốc).
INSERT OR REPLACE INTO members (id, name, role, tg_chat_id, active, zalo_chat_id, password_hash, session_gen) VALUES
  ('anh', 'Chồng', 'owner', NULL, 1, NULL, NULL, 0),
  ('em', 'Vợ', 'adult', NULL, 1, NULL, NULL, 0);
INSERT OR REPLACE INTO accounts (id, name, kind, bank, account_no, sub_account, sepay_enabled, sepay_out, owner_member_id, sepay_connection_id, opening_balance, opened_at, active, locked, spendable, role, deactivated_at, feed_from, sepay_out_from) VALUES
  ('vcb-anh', 'VCB (chính)', 'bank', 'Vietcombank', '0011xxxxxxx', NULL, 1, 0, 'anh', 'default', 0, date('now'), 1, 0, 1, NULL, NULL, NULL, NULL),
  ('tcb-anh', 'TCB (Tích sản)', 'bank', 'Techcombank', '1903xxxxxxx', NULL, 1, 0, 'anh', 'default', 0, date('now'), 1, 0, 1, NULL, NULL, NULL, NULL),
  ('mb-anh', 'MB (Thuế)', 'bank', 'MBBank', '0888xxxxxxx', NULL, 1, 0, 'anh', 'default', 0, date('now'), 1, 0, 1, NULL, NULL, NULL, NULL),
  ('vcb-em', 'VCB (vợ)', 'bank', 'Vietcombank', '0011yyyyyyy', NULL, 1, 0, 'em', 'default', 0, date('now'), 1, 0, 1, NULL, NULL, NULL, NULL),
  ('tien-mat-anh', 'Tiền mặt (chồng)', 'cash', NULL, NULL, NULL, 0, 0, 'anh', NULL, 0, date('now'), 1, 0, 1, NULL, NULL, NULL, NULL),
  ('tien-mat-em', 'Tiền mặt (vợ)', 'cash', NULL, NULL, NULL, 0, 0, 'em', NULL, 0, date('now'), 1, 0, 1, NULL, NULL, NULL, NULL);
INSERT OR REPLACE INTO wallets (id, name, tier, must_group, kind, scope, member_id, account_id, private, sort, active) VALUES
  ('thu-nhap', 'Thu nhập', 'holding', NULL, 'holding', 'shared', NULL, 'vcb-anh', 0, 0, 1),
  ('tich-san', 'Tích sản', 'wealth_building', NULL, 'accrual', 'shared', NULL, 'tcb-anh', 0, 10, 1),
  ('thue', 'Thuế', 'tax', NULL, 'accrual', 'shared', NULL, 'mb-anh', 0, 20, 1),
  ('choi-anh', 'Chơi (chồng)', 'nice', NULL, 'envelope', 'personal', 'anh', 'vcb-anh', 0, 30, 1),
  ('choi-em', 'Chơi (vợ)', 'nice', NULL, 'envelope', 'personal', 'em', 'vcb-em', 0, 31, 1),
  ('du-lich', 'Du lịch', 'nice', NULL, 'accrual', 'shared', NULL, 'vcb-anh', 0, 32, 1),
  ('nha', 'Nhà ở', 'must', 'must', 'accrual', 'shared', NULL, 'vcb-anh', 0, 40, 1),
  ('an', 'Ăn uống', 'must', 'must', 'envelope', 'shared', NULL, 'vcb-anh', 0, 41, 1),
  ('di-lai', 'Đi lại', 'must', 'must', 'envelope', 'shared', NULL, 'vcb-anh', 0, 42, 1),
  ('tien-ich', 'Điện nước mạng', 'must', 'must', 'bill', 'shared', NULL, 'vcb-anh', 0, 43, 1),
  ('ve-que', 'Về quê', 'must', 'must', 'accrual', 'shared', NULL, 'vcb-anh', 0, 44, 1),
  ('co-thi-tot', 'Có thì tốt', 'must', 'have', 'envelope', 'shared', NULL, 'vcb-anh', 0, 50, 1),
  ('thu-cho-thue', 'Thu cho thuê', 'holding', NULL, 'accrual', 'shared', NULL, 'vcb-anh', 0, 5, 1),
  ('loan-interest', 'Lãi vay', 'must', 'must', 'bill', 'shared', NULL, 'vcb-anh', 0, 49, 1);
INSERT OR REPLACE INTO income_streams (id, name, sort, active) VALUES
  ('luong-chong', 'Lương chồng', 10, 1),
  ('luong-vo', 'Lương vợ', 20, 1),
  ('rental', 'Cho thuê lại', 30, 1);
INSERT OR REPLACE INTO categories (id, name, default_wallet_id, icon, sort, active) VALUES
  ('nha-o', 'Nhà ở', 'nha', 'home', 10, 1),
  ('cho-nau', 'Đi chợ / nấu ăn', 'an', 'basket', 11, 1),
  ('an-ngoai', 'Ăn ngoài', 'an', 'utensils', 12, 1),
  ('dien-nuoc', 'Điện nước mạng', 'tien-ich', 'zap', 13, 1),
  ('xang-xe', 'Xăng xe / gửi xe', 'di-lai', 'fuel', 14, 1),
  ('grab', 'Grab / taxi', 'di-lai', 'car', 15, 1),
  ('xe-co', 'Xe cộ (sửa, bảo dưỡng)', 'co-thi-tot', 'wrench', 20, 1),
  ('thiet-bi', 'Thiết bị công việc', 'co-thi-tot', 'laptop', 21, 1),
  ('y-te', 'Y tế (khám, thuốc, TPCN)', 'co-thi-tot', 'pill', 22, 1),
  ('tap-luyen', 'Tập luyện', 'co-thi-tot', 'dumbbell', 23, 1),
  ('bieu-bo-me', 'Biếu bố mẹ', 'co-thi-tot', 'heart', 24, 1),
  ('qua-bieu', 'Quà biếu', 'co-thi-tot', 'gift', 25, 1),
  ('thien-nguyen', 'Thiện nguyện', 'co-thi-tot', 'sprout', 26, 1),
  ('lending', 'Cho vay / trả hộ', 'co-thi-tot', 'swap', 27, 1),
  ('phi-dv', 'Phí ngân hàng / dịch vụ', 'co-thi-tot', 'receipt', 28, 1),
  ('mua-sam', 'Mua sắm', 'choi-anh', 'bag', 30, 1),
  ('du-lich-cat', 'Du lịch', 'du-lich', 'plane', 31, 1),
  ('tu-tap', 'Tụ tập / cà phê', 'choi-anh', 'coffee', 32, 1),
  ('giai-tri', 'Giải trí (phim, app)', 'choi-anh', 'film', 33, 1),
  ('debt-payment', 'Trả nợ', 'thu-cho-thue', 'credit-card', 29, 1);
INSERT OR REPLACE INTO allocations (id, wallet_id, mode, period, amount, percent, target_amount, target_date, floor_amount, priority, start_date, active, split_weekly) VALUES
  (1, 'tich-san', 'percent', 'month', NULL, 0.3, NULL, NULL, NULL, 10, NULL, 1, 0),
  (2, 'thue', 'percent', 'month', NULL, 0.1, NULL, NULL, NULL, 20, NULL, 1, 0),
  (3, 'du-lich', 'goal', 'month', NULL, NULL, 15000000, date('now', '+3 months'), NULL, 30, NULL, 1, 0),
  (4, 'choi-anh', 'flat', 'week', 820000, NULL, NULL, NULL, NULL, 31, NULL, 1, 0),
  (5, 'choi-em', 'flat', 'week', 820000, NULL, NULL, NULL, NULL, 31, NULL, 1, 0),
  (6, 'nha', 'lump', 'month', 8000000, NULL, 8000000, NULL, 8000000, 40, NULL, 1, 0),
  (7, 'an', 'flat', 'week', 625000, NULL, NULL, NULL, 500000, 41, NULL, 1, 0),
  (8, 'di-lai', 'flat', 'week', 300000, NULL, NULL, NULL, 200000, 42, NULL, 1, 0),
  (9, 'tien-ich', 'flat', 'month', 300000, NULL, NULL, NULL, 300000, 43, NULL, 1, 0),
  (10, 've-que', 'flat', 'month', 1000000, NULL, NULL, NULL, NULL, 44, NULL, 1, 0),
  (11, 'co-thi-tot', 'remainder', 'month', NULL, NULL, NULL, NULL, NULL, 99, NULL, 1, 0);
INSERT OR REPLACE INTO income_stream_locks (stream_id, wallet_id, percent, sort) VALUES
  ('luong-vo', 'tich-san', 0.45, 100),
  ('rental', 'thu-cho-thue', 1, 100);
INSERT OR REPLACE INTO rules (id, priority, match_type, pattern, meaning, is_salary, wallet_id, category_id, by_member_id, active, income_stream_id, tenant_id, account_id, counter_account_id, from_wallet_id) VALUES
  (1, 10, 'content', 'LUONG THANG', 'income', 1, 'thu-nhap', NULL, 'anh', 1, NULL, NULL, NULL, NULL, NULL),
  (2, 20, 'code', 'EAN', 'spend', 0, 'an', 'cho-nau', 'anh', 1, NULL, NULL, NULL, NULL, NULL),
  (3, 21, 'code', 'EPL', 'spend', 0, 'choi-anh', 'tu-tap', 'anh', 1, NULL, NULL, NULL, NULL, NULL),
  (4, 22, 'code', 'EXE', 'spend', 0, 'di-lai', 'xang-xe', 'anh', 1, NULL, NULL, NULL, NULL, NULL),
  (5, 23, 'code', 'EMS', 'spend', 0, 'choi-anh', 'mua-sam', 'anh', 1, NULL, NULL, NULL, NULL, NULL),
  (6, 30, 'content', 'XANG', 'spend', 0, 'di-lai', 'xang-xe', 'anh', 1, NULL, NULL, NULL, NULL, NULL),
  (7, 31, 'content', 'SHOPEE', 'spend', 0, 'choi-anh', 'mua-sam', 'anh', 1, NULL, NULL, NULL, NULL, NULL),
  (8, 32, 'content', 'LAZADA', 'spend', 0, 'choi-anh', 'mua-sam', 'anh', 1, NULL, NULL, NULL, NULL, NULL),
  (9, 33, 'content', 'TIKI', 'spend', 0, 'choi-anh', 'mua-sam', 'anh', 1, NULL, NULL, NULL, NULL, NULL);
INSERT OR REPLACE INTO config (k, v) VALUES
  ('tz', 'Asia/Ho_Chi_Minh'),
  ('split_days', '10,25'),
  ('safety_fund_months', '6'),
  ('currency', 'VND'),
  ('rental_income_stream_id', 'rental'),
  ('rental_headcount', '3'),
  ('rental_shared_categories', 'cho-nau,an-ngoai,dien-nuoc'),
  ('notify_daily_time', '07:00'),
  ('notify_weekly_day', '1'),
  ('notify_weekly_time', '08:00'),
  ('notify_quiet_start', '22:00'),
  ('notify_quiet_end', '06:30'),
  ('notify_daily_enabled', '1'),
  ('notify_weekly_enabled', '1'),
  ('notify_pending_enabled', '1'),
  ('setup_done', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
