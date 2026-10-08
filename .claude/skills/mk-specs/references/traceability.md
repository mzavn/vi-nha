# Truy vết, đánh dấu, file sinh tự động, chỉ số, cấu hình

## 1. Dòng `- Tests:` (con trỏ từ AC tới test)

```
- Tests: [`test/checkout.test.ts`](../../test/checkout.test.ts) › "đặt hàng › mã QR hết hạn sau 15 phút"
- Tests: [`test/a.test.ts`](../../test/a.test.ts) › "đơn › tạo được" · "… › huỷ được"; [`web/src/b.test.ts`](../../web/src/b.test.ts) › "giỏ › tính tổng"
- Tests: ⚠ Chưa có test (cần môi trường trình duyệt; bổ sung khi có e2e)
```

- File test trong backtick (thường bọc link tương đối từ file UC); sau đó `›` và tên test trong ngoặc kép: các tầng `describe › it` nối bằng ` › `.
- `"… › it"`: lấy lại tiền tố describe của trích dẫn ngay trước trên cùng dòng.
- `%s`, `$name` trong tên test có tham số khớp mọi chuỗi.
- Không có test: bắt đầu bằng `⚠` (chữ cấu hình theo `language`: `⚠ Chưa có test` / `⚠ No test`) + lý do.
- Mẫu đường dẫn file test: `tests.file_pattern`.

### Kiểu trích dẫn (`tests.citation_style`)

| Kiểu | Nguồn sự thật | verify.py kiểm | Hợp với |
|---|---|---|---|
| `pointer` (mặc định) | Dòng `- Tests:` trong UC; tên test nêu hành vi | Mỗi tên được trích có thật | Repo đã có test đặt tên theo hành vi |
| `name` | Tên test chứa `UC-xxx / AC-n` (tr.28) | Mỗi thẻ trong tên test trỏ tới UC/AC có thật; dòng `- Tests:` nếu có cũng được kiểm. gen.py tự điền cột Test cho AC chưa có dòng `- Tests:` | Project mới muốn từ test fail đọc ngay ra AC |
| `both` | Cả hai | Như `pointer` + test được trích phải mang đúng `UC-xxx / AC-n` của AC đó | Muốn chặt cả hai chiều |

Đánh đổi của `pointer`: từ một test fail phải tra `traceability.md` mới biết nó bảo vệ AC nào; bù lại tên test đọc như câu nghiệp vụ và không phải đổi tên khi AC đổi số.

## 2. Đánh dấu lệch và câu hỏi mở ✚

- `- [DIVERGENCE] <nguồn A> nói X; <nguồn B/code> làm Y. <hệ quả>. → <ai cần quyết>` — hai nguồn mâu thuẫn, **chưa quyết bên nào đúng**. Không im lặng chọn một bên.
- `- [OPEN] <câu hỏi>` — chưa có câu trả lời trong repo.
- Viết ở đầu dòng (bullet cấp 1) trong UC (`## Divergences & Open Questions`), README của context, hoặc `decisions.md`; gen.py gom vào `open-issues.md` và đếm theo context.
- Đóng: xoá dòng khi đã quyết, ghi vào History "đóng [OPEN] …"; quyết định đáng nhớ → ADR.
- Trọng tài giữa `specs/`, `docs/`, `plans/`: principles.md §4. Mục ảnh hưởng tiền/quyền/bảo mật/lời hứa BR → chép tóm tắt vào "Hàng đợi quyết định" của `specs/README.md`.
- Brownfield: chỗ chưa kiểm chứng ghi `⚠ not verified` hoặc Status `legacy-unverified` (workflow-bootstrap.md §3).

## 3. File sinh tự động

`traceability.md` (bảng tổng theo context + mỗi UC một bảng AC → test) và `open-issues.md` (mọi `[DIVERGENCE]`/`[OPEN]`, link đổi về tương đối với `specs/`). Không sửa tay; sửa UC/ADR rồi sinh lại.

```bash
python3 .claude/skills/mk-specs/scripts/gen.py                 # sinh 2 file, cập nhật README, in số đếm + chỉ số
python3 .claude/skills/mk-specs/scripts/gen.py --verified-on 2026-01-31   # đổi ngày "đã kiểm" ở đầu traceability.md
python3 .claude/skills/mk-specs/scripts/verify.py              # chạy tests.list_command, kiểm trích dẫn + link; exit 1 nếu lỗi
python3 .claude/skills/mk-specs/scripts/verify.py --tests list.json       # dùng danh sách test có sẵn
python3 .claude/skills/mk-specs/scripts/audit.py               # báo cáo vệ sinh spec, không sửa gì
python3 .claude/skills/mk-specs/scripts/commit-hash.py [hash] [--dry-run] # thay `chưa commit` trong History/Status
```

Thêm vào `package.json` (hoặc Makefile) để cả người và agent gọi giống nhau: `"specs:gen": "python3 .claude/skills/mk-specs/scripts/gen.py"`, `"specs:check": "python3 .claude/skills/mk-specs/scripts/verify.py"`.

- **Tất định**: chạy hai lần ra cùng từng byte. Khi chuyển từ script cũ sang skill, chạy gen.py rồi `git diff --exit-code specs/traceability.md specs/open-issues.md` — phải không có diff trước khi xoá script cũ.
- `verify.py` kiểm: mỗi tên test được trích có trong danh sách test (`tests.list_command` in JSON `[{"file", "name"}]`, ví dụ `npx vitest list --json`; runner khác: viết lệnh nhỏ in cùng dạng); mọi link tương đối trong `specs/**/*.md` mở được; với `name`/`both` kiểm thẻ UC/AC. Không có danh sách test → chỉ kiểm file test tồn tại. Cảnh báo (không fail) khi còn `chưa commit` trong History.
- Phải ra `unresolved: 0` trước commit merge.

## 4. Chỉ số (gen.py in ra và ghi vào README)

| Chỉ số | Định nghĩa | Ghi chú |
|---|---|---|
| AC Coverage | AC có ≥ 1 test / tổng AC | Quan trọng hơn code coverage; chặn "spec coverage ảo" (tr.60) |
| Spec Coverage | UC có Status thuộc `metrics.active_status` (mặc định `implemented`, `partial`) mà có ≥ 1 AC có test / số UC đó | Greenfield nhắm ~100% phần MVP; brownfield module nóng ~70% sau một quý (tr.60–61) |
| Trace Ratio | Commit (không tính merge) từ `metrics.since` có subject mang ID UC/BR/ADR **có thật trong specs** / tổng commit trừ commit có scope miễn trừ | Chỉ số đầu tiên nên theo dõi (tr.63) |

Không đo: số dòng spec, số UC đóng mỗi tuần, chỉ code coverage. Regen Success Rate (tỉ lệ AI viết lại mà test vẫn xanh) theo dõi thủ công trong retro nếu cần.

## 5. Cấu hình `specs/mk-specs.yml`

Mẫu đầy đủ: `assets/mk-specs.yml.template`. Khoá:

| Khoá | Mặc định | Nghĩa |
|---|---|---|
| `version` | `1` | Phiên bản định dạng cấu hình |
| `language` | `vi` | `vi`/`en`: chữ trong file sinh, dấu thập phân |
| `specs_dir` | `specs` | Thư mục spec, tương đối với gốc repo |
| `contexts` | — | Danh sách `{id, title}` theo thứ tự xuất; `id` là đường dẫn trong `specs_dir` |
| `contexts_glob` | `*` | Dùng khi không liệt kê `contexts`: mọi thư mục khớp glob có file UC (trừ `changes`) |
| `ids.uc` / `ids.br` / `ids.adr` | `UC-\d+` / `BR-\d+` / `ADR-\d+` | Regex ID; file UC tên `<ID>-<slug>.md` |
| `decisions_file` | `decisions.md` | File ADR (bỏ trống nếu không có) |
| `tests.list_command` | `null` | Lệnh in danh sách test dạng JSON |
| `tests.file_pattern` | `` [^`]+\.(?:test\|spec)\.[cm]?[jt]sx? `` | Regex đường dẫn file test trong backtick |
| `tests.citation_style` | `pointer` | `pointer` · `name` · `both` |
| `readme.file` | `README.md` | README của specs (tương đối `specs_dir`) |
| `readme.banner.match` / `keep` | `^> (Cập nhật\|Hợp nhất) ` / `5` | Dòng banner; giữ N dòng mới nhất (theo ngày trong dòng) |
| `readme.lines[].match` | `[]` | Regex có nhóm tên; mỗi nhóm được thay bằng chỉ số cùng tên |
| `metrics.since` | `null` | Ngày (YYYY-MM-DD) bắt đầu đo Trace Ratio — thường là ngày áp dụng |
| `metrics.active_status` | `[implemented, partial]` | Status tính vào Spec Coverage |
| `metrics.exempt_scopes` | `[specs]` | Scope commit không tính vào Trace Ratio |
| `audit.*` | xem `scripts/mkspecs.py` | Mục bắt buộc/khuyến nghị cho audit.py |

Nhóm tên dùng được trong `readme.lines`: `uc`, `ac`, `tested`, `untested`, `divergence`, `open`, `ac_coverage`, `spec_coverage`, `spec_covered`, `spec_active`, `trace_ratio`, `traced`, `trace_total`, `since`, `adr_last`, `br_last`. Dòng không khớp được báo, không bị thêm tự động — viết dòng đó một lần bằng tay rồi gen.py giữ số đúng.

**YAML rút gọn** (scripts chỉ dùng thư viện chuẩn, không cần PyYAML): map khối, list khối (giá trị hoặc map `- id: …`), list một dòng `[a, b]`, chuỗi `'…'` (backslash giữ nguyên — dùng cho regex, `''` là dấu nháy), `"…"` (escape kiểu JSON), số nguyên, `true`/`false`/`null`, chú thích `#` (sau khoảng trắng, ngoài nháy). Không hỗ trợ anchor, chuỗi nhiều dòng (`|`, `>`), map một dòng `{}`, tab để thụt lề.
