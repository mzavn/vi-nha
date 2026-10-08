# specs/changes/ — Đề xuất thay đổi

Mỗi thay đổi hành vi có một thư mục riêng `specs/changes/<yyMMdd>-<slug>/` chứa **một** file `proposal.md`. Spec chính (`specs/<context>/`) chỉ đổi khi thay đổi đã làm xong và được review; lúc đó chuyển thư mục sang `specs/changes/archive/`.

- Mẫu `proposal.md`: [`.claude/skills/mk-specs/assets/templates/proposal.md`](../../.claude/skills/mk-specs/assets/templates/proposal.md) — chép rồi điền, không viết lại từ trí nhớ.
- Vòng đời (đề xuất → duyệt hai phía → test + code → hợp nhất, ba commit): [`.claude/skills/mk-specs/references/workflow-change.md`](../../.claude/skills/mk-specs/references/workflow-change.md).
- Luật riêng của repo (migration, lệnh DoD, xem trên mobile): `AGENTS.md` §5.
