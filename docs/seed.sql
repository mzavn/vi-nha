-- ============ HỘ MẪU — chạy sau docs/schema.sql; sửa số cho khớp thực tế trước khi dùng thật ============
-- Mã (id) tiếng Anh, tên hiển thị tiếng Việt. Gồm cả dữ liệu hệ thống: rule mẫu, nguồn thu / ví / danh mục cho thuê,
-- config rental_* / notify_*. Kết nối SePay 'default' có sẵn trong schema.
INSERT INTO members (id,name,role,tg_chat_id) VALUES
 ('husband','Chồng','owner',NULL), ('wife','Vợ','adult',NULL);

-- TÀI KHOẢN: liệt kê ĐỦ mọi TK của cả hai; sepay_enabled=1 nếu đã đăng ký webhook (bank = mã danh mục ngân hàng SePay)
INSERT INTO accounts (id,name,kind,bank,account_no,sepay_enabled,owner_member_id,sepay_connection_id,opening_balance,opened_at) VALUES
 ('vcb-husband','VCB (chính)','bank','Vietcombank','0011xxxxxxx',1,'husband','default',0,date('now')),
 ('tcb-husband','TCB (Tích sản)','bank','Techcombank','1903xxxxxxx',1,'husband','default',0,date('now')),
 ('mb-husband','MB (Thuế)','bank','MBBank','0888xxxxxxx',1,'husband','default',0,date('now')),
 ('vcb-wife','VCB (vợ)','bank','Vietcombank','0011yyyyyyy',1,'wife','default',0,date('now')),
 ('cash-husband','Tiền mặt (chồng)','cash',NULL,NULL,0,'husband',NULL,0,date('now')),
 ('cash-wife','Tiền mặt (vợ)','cash',NULL,NULL,0,'wife',NULL,0,date('now'));

-- VÍ: thứ tự rót wealth_building -> tax -> nice -> must; Have là ví remainder trong phe must
INSERT INTO wallets (id,name,tier,must_group,kind,scope,member_id,account_id,sort) VALUES
 ('income','Thu nhập','holding',NULL,'holding','shared',NULL,'vcb-husband',0),
 ('rental-income','Thu cho thuê','holding',NULL,'accrual','shared',NULL,'vcb-husband',5),
 ('wealth-building','Tích sản','wealth_building',NULL,'accrual','shared',NULL,'tcb-husband',10),
 ('tax','Thuế','tax',NULL,'accrual','shared',NULL,'mb-husband',20),
 ('fun-husband','Chơi (chồng)','nice',NULL,'envelope','personal','husband','vcb-husband',30),
 ('fun-wife','Chơi (vợ)','nice',NULL,'envelope','personal','wife','vcb-wife',31),
 ('travel','Du lịch','nice',NULL,'accrual','shared',NULL,'vcb-husband',32),
 ('housing','Nhà ở','must','must','accrual','shared',NULL,'vcb-husband',40),
 ('food','Ăn uống','must','must','envelope','shared',NULL,'vcb-husband',41),
 ('transport','Đi lại','must','must','envelope','shared',NULL,'vcb-husband',42),
 ('utilities','Điện nước mạng','must','must','bill','shared',NULL,'vcb-husband',43),
 ('hometown','Về quê','must','must','accrual','shared',NULL,'vcb-husband',44),
 ('nice-to-have','Có thì tốt','must','have','envelope','shared',NULL,'vcb-husband',50);

-- LUẬT NẠP: Tích sản 30% · Thuế 10% (chỉ khi taxable; thuế suất CHỈ nằm ở đây) · Have = remainder
INSERT INTO allocations (wallet_id,mode,period,amount,percent,target_amount,target_date,floor_amount,priority) VALUES
 ('wealth-building','percent','month',NULL,0.30,NULL,NULL,NULL,10),
 ('tax','percent','month',NULL,0.10,NULL,NULL,NULL,20),
 ('travel','goal','month',NULL,NULL,15000000,date('now','+3 months'),NULL,30),
 ('fun-husband','flat','week',820000,NULL,NULL,NULL,NULL,31),
 ('fun-wife','flat','week',820000,NULL,NULL,NULL,NULL,31),   -- cùng priority với fun-husband: thiếu tiền thì chia đều, không ai nhận 0
 ('housing','lump','month',8000000,NULL,8000000,NULL,8000000,40),
 ('food','flat','week',625000,NULL,NULL,NULL,500000,41),
 ('transport','flat','week',300000,NULL,NULL,NULL,200000,42),
 ('utilities','flat','month',300000,NULL,NULL,NULL,300000,43),
 ('hometown','flat','month',1000000,NULL,NULL,NULL,NULL,44),
 ('nice-to-have','remainder','month',NULL,NULL,NULL,NULL,NULL,99);
-- Quỹ an tâm: KHÔNG phải allocation, KHÔNG phải ví riêng.
-- Nó là NGƯỠNG tính động trong ví Tích sản: v_safety_fund = safety_fund_months × chi Must TB.
-- Đổi số tháng thì sửa config('safety_fund_months'), không sửa schema.

-- NGUỒN THU: phần khóa riêng của từng nguồn (lương vợ: 45% vào Tích sản; cho thuê: hết vào ví Thu cho thuê)
INSERT INTO income_streams (id,name,sort) VALUES
 ('salary-husband','Lương chồng',10), ('salary-wife','Lương vợ',20), ('rental','Cho thuê lại',30);
INSERT INTO income_stream_locks (stream_id,wallet_id,percent) VALUES
 ('salary-wife','wealth-building',0.45), ('rental','rental-income',1);

-- DANH MỤC (~20) — chọn danh mục thì ví tự điền; icon là tên trong web/src/ui/icons.tsx.
-- 'debt-payment' và 'lending' là mã hệ thống: khoản trả nợ / cho vay không chọn danh mục thì vào đây.
INSERT INTO categories (id,name,default_wallet_id,icon,sort) VALUES
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
 ('debt-payment','Trả nợ','rental-income','credit-card',29),
 ('shopping','Mua sắm','fun-husband','bag',30),
 ('travel','Du lịch','travel','plane',31),
 ('hangouts','Tụ tập / cà phê','fun-husband','coffee',32),
 ('entertainment','Giải trí (phim, app)','fun-husband','film',33);

-- QUY TẮC: chỉ rule lương mới được gán income; mã chuyển khoản (code) đi trước, nội dung (content) sau
INSERT INTO rules (priority,match_type,pattern,meaning,is_salary,wallet_id,category_id,by_member_id) VALUES
 (10,'content','LUONG THANG','income',1,'income',NULL,'husband'),
 (20,'code','EAN','spend',0,'food','groceries','husband'),
 (21,'code','EPL','spend',0,'fun-husband','hangouts','husband'),
 (22,'code','EXE','spend',0,'transport','fuel-parking','husband'),
 (23,'code','EMS','spend',0,'fun-husband','shopping','husband'),
 (30,'content','XANG','spend',0,'transport','fuel-parking','husband'),
 (31,'content','SHOPEE','spend',0,'fun-husband','shopping','husband'),
 (32,'content','LAZADA','spend',0,'fun-husband','shopping','husband'),
 (33,'content','TIKI','spend',0,'fun-husband','shopping','husband');

INSERT INTO config (k,v) VALUES
 ('tz','Asia/Ho_Chi_Minh'), ('split_days','10,25'),
 ('safety_fund_months','6'), ('currency','VND'),
 ('rental_income_stream_id','rental'), ('rental_headcount','3'),
 ('rental_shared_categories','groceries,eating-out,utilities'),
 ('notify_daily_time','07:00'), ('notify_weekly_day','1'), ('notify_weekly_time','08:00'),
 ('notify_quiet_start','22:00'), ('notify_quiet_end','06:30'),
 ('notify_daily_enabled','1'), ('notify_weekly_enabled','1'), ('notify_pending_enabled','1'),
 ('setup_done', strftime('%Y-%m-%dT%H:%M:%fZ','now'));  -- hộ mẫu coi như đã thiết lập (UC-510): không thì đăng nhập trả 409
