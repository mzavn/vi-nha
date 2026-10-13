-- v1.31 -> v1.32 (lưu chuyển tiền, kết quả thu chi — change 261008-bang-can-doi, lát 2):
--  * transaction_report_classes: chủ nhà xếp lại nhóm báo cáo của một giao dịch (operating | passive_income | investing |
--    financing). Chỉ đổi báo cáo — không đổi ví, số dư, chia tiền. Không phải dòng sổ: đặt / đổi / xoá được (nhật ký
--    report_class.set | clear). Sửa giao dịch (huỷ + ghi mới) thì chép sang dòng mới; giao dịch đã huỷ thì báo cáo bỏ qua.

CREATE TABLE transaction_report_classes (
  transaction_id INTEGER PRIMARY KEY REFERENCES transactions(id),
  report_class   TEXT NOT NULL CHECK (report_class IN ('operating','passive_income','investing','financing')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now')),
  by_member_id   TEXT REFERENCES members(id)
);

UPDATE config SET v = '1.32' WHERE k = 'schema_version';
