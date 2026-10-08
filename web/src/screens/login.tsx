// Đăng nhập (D6, UC-501): chọn người, nhập mật khẩu — mật khẩu chung của nhà, hoặc mật khẩu riêng nếu người đó đã đặt.
// Màn không nói người nào dùng loại nào (UC-701 AC-9). Danh tính quyết định tiền mặt mặc định và ví cá nhân.

import { useEffect, useState } from "preact/hooks";
import { ApiError, api, errorText } from "../lib/api";
import type { MemberRef } from "../lib/types";
import { lastMemberId, login, setState, useApp } from "../state/store";
import { Icon } from "../ui/icons";

export function Login() {
  const { online } = useApp();
  const [members, setMembers] = useState<Pick<MemberRef, "id" | "name">[] | null>(null);
  const [memberId, setMemberId] = useState<string | null>(lastMemberId());
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Lỗi tải danh sách người (thường là mất mạng) tách khỏi lỗi đăng nhập: không tô đỏ ô mật khẩu, có mạng lại thì tự tắt.
  const [listError, setListError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<Pick<MemberRef, "id" | "name">[]>("/v1/session/members")
      .then((list) => {
        setListError(null);
        setMembers(list);
        setMemberId((id) => (id && list.some((m) => m.id === id) ? id : (list[0]?.id ?? null)));
      })
      .catch((err) => setListError(err instanceof ApiError && err.offline ? "Không có mạng. Đăng nhập lần đầu cần mạng." : errorText(err)));
  }, [online]);

  async function submit(e: Event) {
    e.preventDefault();
    if (!memberId || !password) return;
    setBusy(true);
    setError(null);
    try {
      await login(password, memberId);
    } catch (err) {
      // Nhà chưa thiết lập (DB vừa dựng lại): mở màn Thiết lập thay vì báo lỗi.
      if (err instanceof ApiError && err.code === "setup_required") return setState({ phase: "setup" });
      setError(err instanceof ApiError && err.offline ? "Không có mạng. Đăng nhập cần mạng." : errorText(err));
      setBusy(false);
    }
  }

  return (
    <main class="app" style={{ paddingBottom: "32px" }}>
      <div style={{ padding: "calc(40px + var(--safe-top)) 4px 20px" }}>
        <h1 style={{ fontSize: "24px", fontWeight: 650, letterSpacing: "-0.02em" }}>Ví nhà</h1>
        <p style={{ color: "var(--fg-2)", margin: "4px 0 0" }}>Sổ tiền của nhà. Còn bao nhiêu để chi tuần này.</p>
      </div>
      <form class="card" onSubmit={submit}>
        <fieldset style={{ border: 0, margin: 0, padding: "14px 14px 6px" }}>
          <legend style={{ fontSize: "14px", fontWeight: 600, padding: 0, marginBottom: "10px" }}>Ai đang dùng máy này</legend>
          {members === null && !listError && <div class="skeleton" style={{ height: "44px" }} />}
          {listError && (
            <p class="err" role="alert" style={{ margin: 0 }}>
              {listError}
            </p>
          )}
          <div class="seg">
            {members?.map((m) => (
              <button type="button" key={m.id} aria-pressed={m.id === memberId} onClick={() => setMemberId(m.id)} style={{ minWidth: "96px" }}>
                {m.name}
              </button>
            ))}
          </div>
        </fieldset>
        {/* Để Keychain / trình quản lý mật khẩu nhận ra đây là form đăng nhập của "Ví nhà". */}
        <input class="sr-only" type="text" name="username" autocomplete="username" value="vi-nha" readOnly tabIndex={-1} aria-hidden="true" />
        <div class="field" style={{ borderTop: 0 }}>
          <label for="pw">Mật khẩu</label>
          <div class="flex items-center gap-1" style={{ maxWidth: "64%" }}>
            <input
              id="pw"
              class="ctl full"
              type={show ? "text" : "password"}
              autocomplete="current-password"
              value={password}
              onInput={(e) => setPassword(e.currentTarget.value)}
              aria-invalid={error ? "true" : undefined}
              aria-describedby={error ? "login-err" : undefined}
            />
            <button type="button" class="btn btn-ghost" style={{ padding: "0 10px" }} onClick={() => setShow((s) => !s)} aria-label={show ? "Ẩn mật khẩu" : "Hiện mật khẩu"}>
              <Icon name={show ? "eye-off" : "eye"} size={18} />
            </button>
          </div>
        </div>
        {error && (
          <p id="login-err" class="err" role="alert" style={{ margin: 0, padding: "0 14px 6px" }}>
            {error}
          </p>
        )}
        <div class="pad" style={{ paddingBottom: "14px" }}>
          <button type="submit" class="btn btn-primary btn-wide" disabled={busy || !memberId || !password}>
            {busy ? "Đang vào…" : "Vào sổ"}
          </button>
        </div>
        <div class="note" style={{ borderTop: "1px solid var(--border)" }}>
          Chọn người để app biết ai ghi khoản nào và tự điền tài khoản, tiền mặt của người đó. Đổi người thì đăng xuất (Cài đặt › Máy này) rồi chọn lại.
        </div>
      </form>
    </main>
  );
}
