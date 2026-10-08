# specs/ — Đặc tả <tên sản phẩm> (Spec-Driven Development)

> Dựng ngày YYYY-MM-DD <từ đâu: phỏng vấn nghiệp vụ / code, test, docs, git log>.
> Cập nhật YYYY-MM-DD (commit `abc1234`): <một dòng — tối đa 5 dòng "Cập nhật"/"Hợp nhất", dòng cũ bị gen.py bỏ; lịch sử đầy đủ nằm ở History từng UC/ADR và git>.

Quy trình: skill `mk-specs` (`.claude/skills/mk-specs`), cấu hình [`mk-specs.yml`](mk-specs.yml).

## 1. Nguồn sự thật

| Thư mục | Vai trò | Khi mâu thuẫn |
|---|---|---|
| `specs/` | Hành vi đã chốt — BR, UC, Entity, AC, ADR | Chuẩn để review và viết test |
| `specs/changes/` | Đề xuất đang bàn | Chưa có hiệu lực cho tới khi hợp nhất |
| `docs/` | Ý định, nguyên lý, thiết kế | Lệch spec → mở `[DIVERGENCE]`, chủ sản phẩm quyết |
| `plans/` | Lộ trình, báo cáo cũ | Chỉ là lịch sử, không sửa cho khớp |

Code lệch spec = bug **hoặc** spec chưa cập nhật. Trước khi merge, trả lời: "rule này đến từ spec nào?".

## 2. Bốn tầng yêu cầu

| Tầng | Trả lời | Ở đâu |
|---|---|---|
| Business Requirement | Vì sao làm? | [business-requirements.md](business-requirements.md) — BR-01…BR-01 |
| Use Case | Ai làm gì? | `specs/<context>/UC-XXX-*.md` |
| Entity Model | Nói về những khái niệm nào? | `specs/<context>/entities.md` |
| Acceptance Criteria | Biết đúng bằng cách nào? | `## Acceptance Criteria` trong từng UC |

Quyết định: [decisions.md](decisions.md) — ADR-01…ADR-01.

## 3. Context và dải ID

| Context | Thư mục | UC | Code chính |
|---|---|---|---|
| <tên> | [<id>/](<id>/README.md) | UC-101… | `src/...` |

ID vĩnh viễn: không đánh số lại, không dùng lại. AC bỏ thì ghi `(deprecated vN: lý do)`, không xoá.

## 4. Chỉ mục Use Case

0 UC · 0 AC · 0 AC có test · **0 AC chưa có test** (chi tiết: [traceability.md](traceability.md)).
Chỉ số: AC Coverage — · Spec Coverage — (0/0 UC) · Trace Ratio — (0/0 commit từ —).

## 5. Hàng đợi quyết định

Toàn bộ 0 divergence và 0 câu hỏi mở nằm ở [open-issues.md](open-issues.md). Dưới đây là các mục ảnh hưởng tới tiền, quyền truy cập, bảo mật hoặc lời hứa trong BR — chờ chủ sản phẩm quyết.

## 6. File sinh tự động

`traceability.md`, `open-issues.md` và các dòng đếm/chỉ số ở trên do `gen.py` sinh; sửa UC/ADR rồi sinh lại, không sửa tay.
