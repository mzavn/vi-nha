# AGENTS.md — luật làm việc cho mọi coding agent (Claude Code đọc qua `CLAUDE.md` → `@AGENTS.md`)

## Cài Ví nhà

Người dùng nhờ bạn **cài Ví nhà lên Cloudflare của họ** (không phải sửa code): đọc [`docs/cai-bang-ai.md`](docs/cai-bang-ai.md) và làm đúng từng bước trong đó. Không tự soạn lệnh `wrangler` ngoài kịch bản; không chạy `npx wrangler login` hộ (người dùng tự chạy trong terminal); không in lại mật khẩu chung vào chat sau lần đầu. Phần dưới đây là luật khi **sửa code**.

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.

**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:

- State your assumptions explicitly. If uncertain, ask.

- If multiple interpretations exist, present them - don't pick silently.

- If a simpler approach exists, say so. Push back when warranted.

- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.

- No abstractions for single-use code.

- No "flexibility" or "configurability" that wasn't requested.

- No error handling for impossible scenarios.

- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:

- Don't "improve" adjacent code, comments, or formatting.

- Don't refactor things that aren't broken.

- Match existing style, even if you'd do it differently.

- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:

- Remove imports/variables/functions that YOUR changes made unused.

- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:

- "Add validation" → "Write tests for invalid inputs, then make them pass"

- "Fix the bug" → "Write a test that reproduces it, then make it pass"

- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:

\`\`\`

1. \[Step\] → verify: \[check\]

2. \[Step\] → verify: \[check\]

3. \[Step\] → verify: \[check\]

\`\`\`

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

## 5. Spec-Driven Development — luật riêng của repo này

Quy trình chung và cổng cứng: khối `mk-specs` cuối file (do `install.sh` quản lý, đừng sửa tay). Cửa vào của spec: `specs/README.md`.

- **Người duyệt nghiệp vụ là người duy trì repo.** Rule về tiền, quyền truy cập, bảo mật: người duy trì quyết, AI chỉ đề xuất. Người duy trì nói "cứ làm" thì vẫn viết proposal, nhưng không cần chờ duyệt nghiệp vụ.
- **Thay đổi DB**: migration mới trong `migrations/` (số kế tiếp sau migration cuối), cập nhật `docs/schema.sql` + `schema_version`, `test/schema.test.ts` phải xanh. `migrations/0030_baseline.sql` và migration đã phát hành: không sửa. Trước khi chạy migration trên production: sao lưu D1 production.
- **Lệnh**: `npm run specs:gen` (sinh `traceability.md`, `open-issues.md`, dòng đếm/chỉ số README), `npm run specs:check` (phải 0 unresolved).
- **Definition of Done** (thêm vào DoD của skill): `npm test`, `npm run typecheck`, `npm run build` xanh · đã chạy thử đường thay đổi (UI: xem tận mắt trên mobile 390px).
- **Ngôn ngữ**: giao diện, tin nhắn, chú thích, tên test, specs viết tiếng Việt; tên biến / hằng / hàm / kiểu / file, giá trị lưu DB, trường và đường dẫn API, địa chỉ màn PWA, tên và mô tả tool MCP viết tiếng Anh. Bảng tra: `docs/glossary.md`.
- **Sửa dữ liệu riêng của một nhà** (tách bill, số dư đầu…): script chạy một lần hoặc màn app, **không** viết thành migration — migration chạy trên DB của mọi nhà.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.

<!-- mk-specs:start v1.1.0 -->
## Spec-Driven Development (mk-specs)

Repo này làm theo SDD. Trước khi đổi bất kỳ hành vi nào (tính năng, luật nghiệp vụ, API, giao diện người dùng thấy): đọc `.claude/skills/mk-specs/SKILL.md` và `specs/mk-specs.yml`, rồi làm đúng quy trình trong đó. Agent không hỗ trợ skill vẫn đọc được: `SKILL.md` là markdown thường, scripts chạy bằng `python3`.

Cổng cứng (áp dụng cả khi chưa mở skill):
- Không có AC thì không code; spec không nói thì hỏi, không đoán — sửa spec trước rồi mới sửa code.
- Luật tiền, quyền truy cập, bảo mật: người quyết, AI chỉ đề xuất.
- Không tự duyệt spec của chính mình.
- Commit mang ID: `<type>(UC-xxx): …`; spec commit trước code.
- Sửa spec xong: `python3 .claude/skills/mk-specs/scripts/gen.py` rồi `python3 .claude/skills/mk-specs/scripts/verify.py` (phải 0 lỗi).

Luật riêng của repo nằm ngoài khối này.
<!-- mk-specs:end -->
