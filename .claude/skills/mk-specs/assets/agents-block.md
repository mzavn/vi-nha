## Spec-Driven Development (mk-specs)

Repo này làm theo SDD. Trước khi đổi bất kỳ hành vi nào (tính năng, luật nghiệp vụ, API, giao diện người dùng thấy): đọc `.claude/skills/mk-specs/SKILL.md` và `specs/mk-specs.yml`, rồi làm đúng quy trình trong đó. Agent không hỗ trợ skill vẫn đọc được: `SKILL.md` là markdown thường, scripts chạy bằng `python3`.

Cổng cứng (áp dụng cả khi chưa mở skill):
- Không có AC thì không code; spec không nói thì hỏi, không đoán — sửa spec trước rồi mới sửa code.
- Luật tiền, quyền truy cập, bảo mật: người quyết, AI chỉ đề xuất.
- Không tự duyệt spec của chính mình.
- Commit mang ID: `<type>(UC-xxx): …`; spec commit trước code.
- Sửa spec xong: `python3 .claude/skills/mk-specs/scripts/gen.py` rồi `python3 .claude/skills/mk-specs/scripts/verify.py` (phải 0 lỗi).

Luật riêng của repo nằm ngoài khối này.
