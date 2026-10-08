# Artifact: bố cục, quy ước, mẫu

Mẫu nằm ở `assets/templates/` (chép rồi điền, không viết lại từ trí nhớ). File này nói *quy tắc* cho từng loại.

## 1. Bố cục

```
specs/
├── mk-specs.yml               cấu hình skill (bắt buộc)
├── README.md                  cửa vào: nguồn sự thật, 4 tầng, context, chỉ mục UC, dòng đếm + chỉ số, hàng đợi quyết định
├── business-requirements.md   BR (hoặc business-requirements/BR-XX-<slug>.md, mỗi BR một file)
├── decisions.md               ADR: mục lục + từng ADR
├── <context>/
│   ├── README.md              ngôn ngữ chung, danh sách UC, [OPEN] chung của context
│   ├── entities.md            Entity Model
│   └── UC-XXX-<slug>.md       mỗi use case một file
├── changes/
│   ├── README.md              trỏ tới mẫu proposal của skill
│   ├── <yyMMdd>-<slug>/proposal.md   đề xuất đang bàn
│   └── archive/<yyMMdd>-<slug>/      đề xuất đã hợp nhất hoặc bị từ chối
├── traceability.md            SINH TỰ ĐỘNG — UC ↔ AC ↔ test
└── open-issues.md             SINH TỰ ĐỘNG — mọi [DIVERGENCE]/[OPEN]
```

Biến thể theo sách (`specs/use-cases/<context>/…`, tr.55–57) dùng được: đặt `contexts_glob: "use-cases/*"` hoặc liệt kê `contexts` với `id: use-cases/checkout`. Cấu trúc code không bắt buộc soi chiếu UC; khi code tổ chức theo lớp, map qua cột "Code chính" ở README và mục `## Traceability` của UC.

Mẫu tương ứng: `specs-readme.md`, `business-requirement.md`, `adr.md`, `context-readme.md`, `entities.md`, `use-case.md`, `proposal.md`.

## 2. ID và trạng thái

- ID vĩnh viễn: không đánh số lại, không dùng lại ID đã bỏ, không đổi ID khi chuyển context. AC bỏ đi: giữ tiêu đề, thêm `(deprecated vN: lý do)`, bỏ dòng Tests nếu test đã xoá.
- Mỗi context một dải UC (UC-101…, UC-201…) để nhìn ID là biết context. Mẫu regex ở `ids` trong `mk-specs.yml`.
- Status UC: `draft` · `reviewed` · `implemented` · `partial` (hứa trong spec nhưng mới làm một phần — ghi rõ phần thiếu bằng `[OPEN]`) · `spec-only` (đã chốt, chưa code) · `deprecated` · `legacy-unverified` (brownfield, chưa ai xác nhận).
- Status BR: `draft` · `approved` · `in-progress` · `done`. Status ADR: `accepted` · `proposed (awaiting owner)` · `superseded by ADR-xx` · `rejected`. Status proposal: `draft` · `reviewing` · `approved` · `implemented` · `archived` · `rejected`.

## 3. Business Requirement

- Trả lời "vì sao làm?": ngắn, đo được, chưa nói giải pháp (tr.13).
- Bắt buộc: Goal, Success Metrics, Out of Scope. Nên có: Status, Owner, Stakeholders, Background, In Scope, Related Use Cases (liệt kê UC-ID, không chỉ trỏ thư mục), Constraints (Technical / Regulatory / Timeline), Open Questions, History (tr.71–72).
- Một file chung hay mỗi BR một file đều được; cả repo theo một cách. BR cũng tăng bản (v2 ghi phần mới đưa vào Out of Scope).

## 4. Use Case

Bắt buộc: dòng đầu `# UC-XXX: <tên>`, metadata `- Status:`, `- BR:`, `## History`, `## Main Flow` (hoặc nhiều `## Main Flow — <nhánh>`), `## Acceptance Criteria`.
Nên có: `- Owner:`, `- Decisions:`, `- Actor:`, `- Trigger:`, `## Preconditions`, `## Alternative Flows`, `## Exceptions`, `## Postconditions`, `## Dependencies` (Upstream / Downstream UC, External Systems), `## Divergences & Open Questions`, `## Traceability`.

- **Ngôn ngữ nghiệp vụ** ở Main Flow, Alternative Flows, Exceptions, Postconditions, AC: người không biết code đọc được và góp ý được (tr.14). Endpoint, tên hàm, mã lỗi, payload, tên bảng đặt ở `## Traceability` hoặc một dòng con `- Kỹ thuật: …` dưới bước. Áp dụng cho chữ mới/sửa; UC cũ được chuyển khi chạm tới (`audit.py` liệt kê chỗ cần chuyển).
- Main Flow là đường suôn sẻ, đánh số; Alternative Flows đánh số theo bước gốc (`2a.`, `4b.`); Exceptions `E1.`… là lỗi **đã có quyết định xử lý** — khác bug (tr.17).
- Actor và Trigger quyết định thiết kế (người dùng vs job vs webhook) — luôn ghi.
- Vòng đầu không cần nghĩ hết nhánh; time-box 1–2 giờ cho một UC, đủ Main Flow + vài AC (tr.26, 42).
- `## History` mỗi lần đổi một dòng: `- vN (YYYY-MM-DD, commit \`hash\`): <đổi gì>`; chưa có hash thì `chưa commit`, thay sau bằng `scripts/commit-hash.py`. Có thể đặt ngay sau metadata (dễ thấy) hoặc cuối file; cả repo theo một chỗ.

## 5. Acceptance Criteria

```
### AC-n: <tên ngắn>
- Given <dữ liệu cụ thể>
- When <hành động>
- Then <kết quả đo được>
- Tests: <con trỏ test — cú pháp ở traceability.md> | ⚠ Chưa có test (<lý do>)
```

- Cụ thể tới con số và thời hạn ("hết hạn sau 15 phút", "trong 10 giây"); có hệ quả phủ định khi quan trọng ("KHÔNG tạo đơn", "số dư KHÔNG đổi"); Given có dữ liệu thật sự (ngày, số tiền) (tr.38).
- Mỗi AC ≥ 1 test. AC quan trọng chưa có test phải ghi lý do.
- Không xoá AC; sửa thì ghi History; bỏ thì `(deprecated vN: lý do)`.
- Hậu tố chữ (`AC-3a`) dùng được khi chèn AC giữa hai AC cũ mà không đánh số lại.

## 6. Entity Model

Không phải ERD: tên nghiệp vụ, nghĩa, trạng thái, quan hệ, bất biến; không kiểu dữ liệu/index/khoá ngoại (tr.14–15). Thuộc tính mới ghi **rule đặt giá trị + thời điểm + có đổi về sau không + BR nguồn** (tr.24). Một từ mang hai nghĩa ở hai nơi → tách context, mỗi context một `entities.md` và bảng "Ngôn ngữ chung" có cột "Khác context khác?" (tr.18–19).

## 7. ADR ✚

- `decisions.md` có bảng mục lục (ID · ngày · quyết định một câu · status · context) và mỗi ADR một mục `## ADR-NN: …` (mẫu `adr.md`).
- Bắt buộc: Context, Decision, **Phương án bị loại** (kèm lý do), Consequences, **Verified in code** (symbol + tên test đang thi hành quyết định), **Source** (ai quyết, ngày, trích nguyên lời, link change).
- ID kế tiếp, không chèn giữa. Quyết định bị thay: ADR cũ đổi status `superseded by ADR-xx`, giữ nguyên nội dung.
- UC trỏ tới ADR bằng dòng `- Decisions:`.

## 8. Proposal (change folder) ✚

- Một thư mục `specs/changes/<yyMMdd>-<slug>/` với **một** `proposal.md` (mẫu `proposal.md`). Thay đổi lớn được thêm `design.md`, `tasks.md` nếu cần, nhưng proposal vẫn là cửa vào.
- `## Vì sao` trích nguyên lời người yêu cầu; chưa nói giải pháp.
- `## Thay đổi spec` viết delta: `ADDED` / `MODIFIED` (cũ → mới) / `DEPRECATED` AC, đoạn flow đổi, thuộc tính entity đổi.
- Dòng `Người duyệt nghiệp vụ` và `Người duyệt kỹ thuật` phải có tên + ngày trước khi code; dòng `Commit` ghi ba hash khi xong.
- Proposal chưa hợp nhất không có hiệu lực; spec chính chỉ đổi ở bước merge.

## 9. README của specs

- Là **cửa vào**, không phải changelog: tối đa 5 dòng banner "Cập nhật …"/"Hợp nhất …" (gen.py tự bỏ dòng cũ nhất theo `readme.banner`); lịch sử đầy đủ nằm ở History từng UC/ADR và `git log -- specs/`.
- Dòng đếm, dải ID (`BR-01…BR-NN`, `ADR-01…ADR-NN`), dòng chỉ số, số divergence/open do gen.py cập nhật theo `readme.lines` — không sửa tay.
- Mục "Hàng đợi quyết định": chỉ những `[DIVERGENCE]`/`[OPEN]` ảnh hưởng tới tiền, quyền, bảo mật hoặc lời hứa trong BR, mỗi mục một dòng + link UC.
