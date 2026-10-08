# Khởi tạo specs (mode `init`)

## 1. Cài đặt chung cho mọi project

1. Cài skill vào project: `bash <mk-skills>/install.sh --project <repo>` (đứng trong repo: `--project .`; chạy lại bao nhiêu lần cũng được — thiếu thì thêm, có rồi thì giữ hoặc cập nhật). Lệnh chép skill vào `<repo>/.claude/skills/mk-specs`, tạo `<repo>/specs/mk-specs.yml` từ mẫu nếu chưa có, ghi khối `mk-specs` vào `AGENTS.md` (file chung mọi agent đọc), thêm `@AGENTS.md` vào `CLAUDE.md`, và một dòng trỏ `AGENTS.md` vào `GEMINI.md` nếu file đó có. Agent đọc `.agents/skills` (vd Codex) → thêm `--agents-dir`.
2. Sửa `specs/mk-specs.yml`: `contexts`, `ids`, `tests.list_command`, `tests.citation_style` (project mới: cân nhắc `name` hoặc `both`), `metrics.since` = ngày áp dụng.
3. Tạo khung từ `assets/templates/`: `specs/README.md` (`specs-readme.md`), `business-requirements.md`, `decisions.md` (tiêu đề + bảng mục lục rỗng), `changes/README.md` (một đoạn trỏ tới `.claude/skills/mk-specs/assets/templates/proposal.md`), `changes/archive/`, mỗi context một thư mục với `README.md` + `entities.md`.
4. Thêm lệnh `specs:gen` / `specs:check` (traceability.md §3).
5. Luật riêng của repo (lệnh DoD, quy định migration/schema, cách xem giao diện, người duyệt) viết vào `AGENTS.md`, **ngoài** khối `mk-specs` (khối đó do `install.sh` quản lý, sửa tay sẽ bị ghi đè). `CLAUDE.md` chỉ giữ `@AGENTS.md` + điều riêng cho Claude nếu có. Luật chung đã nằm trong skill — không chép lại.
6. Chạy gen.py + verify.py; commit `chore(specs): adopt mk-specs`.

Rồi chọn nhánh greenfield (§2) hoặc brownfield (§3).

## 2. Greenfield — sản phẩm mới

Diễn giải theo nhật ký 5 ngày của sách (tr.32–43).

1. **Inception (BR)** — 60–90 phút với người nghiệp vụ, không bàn DB/UI. Hỏi: hằng ngày đang làm gì; phần nào tốn thời gian nhất; nếu chỉ làm được 3 việc thì là gì; cái gì chắc chắn chưa cần. Kết quả: BR một trang có Goal, Success Metrics, **Out of Scope**.
2. **Danh mục UC** — AI đề xuất danh sách UC từ BR; người gộp/bỏ. Mỗi UC chỉ là **stub**: ID + tên + một dòng. Commit `docs(BR-01): initial requirement catalog, N use cases`.
3. **Entity Model sơ bộ** — AI đề xuất, người review cùng phía nghiệp vụ; chỗ cố ý chưa làm ghi vào entity + Out of Scope.
4. **UC dẫn dắt** — chọn UC nhiều luật nhất, viết đầy đủ (time-box 1–2 giờ), làm mẫu cho các UC còn lại.
5. **Plan → review plan** — đọc plan của AI trước khi cho code; bắt chỗ trái spec (tr.39).
6. **Implement theo vòng đời change** (workflow-change.md), review từng commit nhỏ. AI hỏi điều spec chưa nói → sửa spec, không đoán.
7. **Phản hồi sau demo** — phân loại: đã Out of Scope (ghi BR v2) · bug (fix) · thiếu AC (thêm AC rồi làm) · chỉnh giao diện (tr.40–41).

### Checklist 7 ô trước khi viết dòng code đầu (tr.42–43)

- [ ] BR một trang: Goal, Success Metrics, Out of Scope
- [ ] 5–10 UC chính (ID + một dòng)
- [ ] Entity Model sơ bộ, đặt tên theo nghiệp vụ
- [ ] Đã cài mk-specs, có `specs/mk-specs.yml`
- [ ] Quy ước commit có ID (workflow-change.md §5)
- [ ] Quy ước test ↔ AC (`tests.citation_style`)
- [ ] Mỗi proposal có ≥ 1 người duyệt nghiệp vụ và ≥ 1 người duyệt kỹ thuật

**Không AC thì không code** (tr.42).

## 3. Brownfield — codebase đang chạy

Hai sai lầm phải tránh (tr.44–45): viết lại toàn bộ bằng AI khi chưa có baseline; coi spec AI sinh từ code là sự thật (có thể biến bug thành feature). `specs/` mô tả hành vi **đang chạy, kể cả khi nó xấu**; muốn sửa thì qua `changes/`.

### Bước 0 — phân loại module theo độ nóng (tr.50–51)

```bash
git log --since=6.months.ago --name-only --format= | sort | uniq -c | sort -rn | head -40
```

| Độ nóng | Dấu hiệu | Đầu tư |
|---|---|---|
| Nóng | Đổi gần như mỗi tuần/sprint | Spec đủ + characterization test + AC test |
| Ấm | Đổi vài lần một quý | UC stub; viết đủ + test khi sắp đụng |
| Lạnh | Gần như không đổi | Để yên; chỉ ghi tên context |

Chia bounded context trước, chi tiết sau. Hỏi AI "các module này thuộc context nào?" chỉ để có điểm bắt đầu thảo luận.

### Năm bước (tr.45–50)

1. **Entity Model từ dữ liệu** — đọc schema/migration, AI đề xuất tên nghiệp vụ cho bảng/cột khó hiểu; trường chưa rõ nghĩa ghi `⚠ chưa rõ nghĩa`; ngồi với người vận hành xác nhận từng chỗ.
2. **UC từ code + log + giao diện** — entrypoint (route, handler, job, webhook) là cửa vào; log production cho biết cái gì thật sự được dùng; giao diện cho biết người dùng bấm gì. Mỗi UC gắn mức tin cậy:
   - **rõ** — có entrypoint + dấu vết sử dụng + người xác nhận → Status `implemented`;
   - **đoán** — có code, chưa ai xác nhận → `implemented` + `[OPEN] cần xác nhận: …` hoặc `⚠ not verified` trên AC;
   - **bí ẩn** — không rõ ai dùng, vì sao tồn tại → Status `legacy-unverified`, thêm đo đạc sử dụng, không đụng một thời gian (sách: 4 tuần), sau đó đề xuất bỏ hoặc tìm người hiểu.
   Mỗi câu trong spec đối chiếu với code; tài liệu cũ nói khác code → `[DIVERGENCE]`, không chọn im lặng.
3. **Kiểm chứng với nghiệp vụ — hàng đợi cho chủ sản phẩm** — gom `[DIVERGENCE]`/`[OPEN]` ảnh hưởng tiền, quyền, bảo mật, lời hứa BR vào "Hàng đợi quyết định" của `specs/README.md`; đi qua từng context (đọc AC: đúng thực tế không? thiếu case nào? rule "đương nhiên" nào chưa có?). Rule ẩn tìm ra → UC/AC mới **qua change folder**, có owner nghiệp vụ.
4. **Characterization test trước khi refactor** — chụp hành vi hiện tại bằng dữ liệu thật đã ẩn danh (vài chục bản ghi). Loại test này không chứng minh đúng, chỉ chứng minh chưa đổi hành vi (tr.49). Đặt trong thư mục riêng (vd `test/characterization/`).
5. **Refactor có bảo vệ** — refactor không đổi hành vi; đổi hành vi phải có spec; **một thay đổi không vừa refactor lớn vừa đổi luật**; characterization test + AC test đều xanh. Chạy song song cũ/mới (feature flag) khi rủi ro; lệch thì xem spec + dữ liệu mẫu để quyết bên nào đúng (tr.49–50).

### Nguyên tắc thực dụng (tr.50–52)

- Spec brownfield được phép "xấu": TODO kiểm chứng, ghi chú lịch sử, thuật ngữ cũ cạnh thuật ngữ mới.
- Mỗi lần chạm module, để lại nó rõ hơn một chút (chuyển Main Flow sang ngôn ngữ nghiệp vụ, thêm test cho AC chạm tới).
- Dừng đào sâu khi: người mới làm độc lập được trong một module bất kỳ sau một tuần; module nóng có Spec Coverage > 70% và UC quan trọng có AC test; câu "làm được không?" trả lời được trong một giờ. Mục tiêu là *dừng vay thêm nợ*, không phải trả hết nợ.
- Đặt `metrics.since` = ngày áp dụng: commit cũ không tính vào Trace Ratio.
