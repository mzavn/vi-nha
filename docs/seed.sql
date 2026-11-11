-- ============ HỘ MẪU — chạy sau docs/schema.sql; sửa số cho khớp thực tế trước khi dùng thật ============
-- Mã (id) tiếng Anh, tên hiển thị tiếng Việt. Gồm cả dữ liệu hệ thống: rule mẫu, nguồn thu / danh mục cho thuê,
-- config rental_* / notify_*. Kết nối SePay 'default' có sẵn trong schema. Không có ví (v2): tiền thuộc ngăn của tài khoản.
INSERT INTO members (id,name,role,tg_chat_id) VALUES
 ('husband','Chồng','owner',NULL), ('wife','Vợ','adult',NULL);

-- TÀI KHOẢN: liệt kê ĐỦ mọi TK của cả hai; sepay_enabled=1 nếu đã đăng ký webhook (bank = mã danh mục ngân hàng SePay)
INSERT INTO accounts (id,name,kind,bank,account_no,sepay_enabled,owner_member_id,sepay_connection_id,opening_balance,opened_at) VALUES
 ('vcb-husband','VCB (chính)','bank','Vietcombank','0011xxxxxxx',1,'husband','default',0,date('now')),
 ('tcb-husband','TCB (Tích sản)','bank','Techcombank','1903xxxxxxx',1,'husband','default',0,date('now')),
 ('mb-husband','MB (Thuế)','bank','MBBank','0888xxxxxxx',1,'husband','default',0,date('now')),
 ('vcb-wife','VCB (vợ)','bank','Vietcombank','0011yyyyyyy',1,'wife','default',0,date('now')),
 ('cash-husband','Tiền mặt (chồng)','cash',NULL,NULL,0,'husband',NULL,0,date('now')),
 ('cash-wife','Tiền mặt (vợ)','cash',NULL,NULL,0,'wife',NULL,0,date('now')),
 ('mb-tuition','MB (học phí)','bank','MBBank',NULL,0,'husband',NULL,0,date('now')),
 ('mb-reward','MB (Ví Thưởng)','bank','MBBank',NULL,0,'wife',NULL,0,date('now'));

-- NGUỒN THU: "Lương chồng" mở kỳ lương; cho thuê không mở kỳ.
INSERT INTO income_streams (id,name,sort,opens_cycle) VALUES
 ('salary-husband','Lương chồng',10,1), ('salary-wife','Lương vợ',20,0), ('rental','Cho thuê lại',30,0);

-- NHÓM DANH MỤC: hạn mức mềm mỗi kỳ lương (pocket UC-1204); Thiết yếu = 1.
INSERT INTO category_groups (id,name,essential,cycle_limit,sort) VALUES
 ('fun-husband','Chơi (chồng)',0,3554000,30), ('travel','Du lịch',0,NULL,32), ('housing','Nhà ở',1,NULL,40),
 ('food','Ăn uống',1,2709000,41), ('transport','Đi lại',1,1300000,42), ('utilities','Điện nước mạng',1,NULL,43),
 ('nice-to-have','Có thì tốt',0,NULL,50);

-- DANH MỤC (~20) — icon là tên trong web/src/ui/icons.tsx.
-- 'debt-payment' và 'lending' là mã hệ thống: khoản trả nợ / cho vay không chọn danh mục thì vào đây.
INSERT INTO categories (id,name,group_id,icon,sort) VALUES
 ('housing','Nhà ở','housing','home',10),
 ('groceries','Đi chợ / nấu ăn','food','basket',11),
 ('eating-out','Ăn ngoài','food','utensils',12),
 ('utilities','Điện nước mạng','utilities','zap',13),
 ('fuel-parking','Xăng xe / gửi xe','transport','fuel',14),
 ('ride-hailing','Grab / taxi','transport','car',15),
 ('vehicle','Xe cộ (sửa, bảo dưỡng)','nice-to-have','wrench',20),
 ('work-gear','Thiết bị công việc','nice-to-have','laptop',21),
 ('health','Y tế (khám, thuốc, TPCN)','nice-to-have','pill',22),
 ('fitness','Tập luyện','nice-to-have','dumbbell',23),
 ('parents','Biếu bố mẹ','nice-to-have','heart',24),
 ('gifts','Quà biếu','nice-to-have','gift',25),
 ('charity','Thiện nguyện','nice-to-have','sprout',26),
 ('lending','Cho vay / trả hộ','nice-to-have','swap',27),
 ('bank-fees','Phí ngân hàng / dịch vụ','nice-to-have','receipt',28),
 ('debt-payment','Trả nợ',NULL,'credit-card',29),
 ('shopping','Mua sắm','fun-husband','bag',30),
 ('travel','Du lịch','travel','plane',31),
 ('hangouts','Tụ tập / cà phê','fun-husband','coffee',32),
 ('entertainment','Giải trí (phim, app)','fun-husband','film',33);

-- QUY TẮC: chỉ rule lương mới được gán income; mã chuyển khoản (code) đi trước, nội dung (content) sau.
-- Mẫu lương gắn nguồn "Lương chồng" (nguồn mở kỳ lương, pocket UC-1205).
INSERT INTO rules (priority,match_type,pattern,meaning,is_salary,category_id,by_member_id,income_stream_id) VALUES
 (10,'content','LUONG THANG','income',1,NULL,'husband','salary-husband');
INSERT INTO rules (priority,match_type,pattern,meaning,is_salary,category_id,by_member_id) VALUES
 (20,'code','EAN','spend',0,'groceries','husband'),
 (21,'code','EPL','spend',0,'hangouts','husband'),
 (22,'code','EXE','spend',0,'fuel-parking','husband'),
 (23,'code','EMS','spend',0,'shopping','husband'),
 (30,'content','XANG','spend',0,'fuel-parking','husband'),
 (31,'content','SHOPEE','spend',0,'shopping','husband'),
 (32,'content','LAZADA','spend',0,'shopping','husband'),
 (33,'content','TIKI','spend',0,'shopping','husband');

INSERT INTO config (k,v) VALUES
 ('tz','Asia/Ho_Chi_Minh'),
 ('safety_fund_months','6'), ('currency','VND'),
 ('rental_income_stream_id','rental'), ('rental_headcount','3'),
 ('rental_shared_categories','groceries,eating-out,utilities'),
 ('notify_daily_time','07:00'), ('notify_weekly_day','1'), ('notify_weekly_time','08:00'),
 ('notify_quiet_start','22:00'), ('notify_quiet_end','06:30'),
 ('notify_daily_enabled','1'), ('notify_weekly_enabled','1'), ('notify_pending_enabled','1'),
 ('setup_done', strftime('%Y-%m-%dT%H:%M:%fZ','now'));  -- hộ mẫu coi như đã thiết lập (UC-510): không thì đăng nhập trả 409

-- BA NGĂN: tài khoản chi tiêu ở Vận hành; hai tài khoản MB phụ ở Dự phòng (một cho mục tiêu Học phí, một là Ví Thưởng);
-- coi như cả nhà đã xác nhận. Đổi ở Cài đặt › Ba ngăn.
UPDATE accounts SET pocket = 'operating', pocket_confirmed = 1;
UPDATE accounts SET pocket = 'reserve' WHERE id IN ('mb-tuition', 'mb-reward');
UPDATE config SET v = '30' WHERE k = 'savings_pct';

-- MỤC TIÊU DỰ PHÒNG: mỗi mục tiêu gắn một tài khoản thật (nhiều mục tiêu dùng chung được; A chia từ số dư theo thứ tự
-- ưu tiên `sort`, hạn gần trước). Học phí gắn tài khoản MB học phí; Bảo dưỡng xe và Thuế thu nhập chưa gắn tài khoản
-- (chưa sinh việc nạp, Hôm nay nhắc mở tài khoản thật).
INSERT INTO reserve_goals (id,name,account_id,target_amount,target_pct,monthly_amount,repeat_months,due_date,sort) VALUES
 ('tuition','Học phí','mb-tuition',6000000,NULL,2000000,3,'2027-01-15',10),
 ('income-tax','Thuế thu nhập',NULL,NULL,10,NULL,NULL,NULL,30),
 ('car-service','Bảo dưỡng xe',NULL,4800000,NULL,NULL,NULL,'2027-03-31',20);
-- Dư cuối kỳ: 50% vào Tích luỹ (mặc định của schema), phần còn lại vào tài khoản Ví Thưởng (UC-1207).
INSERT INTO config (k,v) VALUES ('surplus_reward_account','mb-reward');
