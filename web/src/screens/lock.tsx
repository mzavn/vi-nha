// Màn khóa mã PIN (pwa UC-719): thay cả màn app — không phải lớp phủ, vì sheet là <dialog> ở top layer, lớp phủ không che được.
// Đúng PIN → về đúng màn đang ở (địa chỉ giữ nguyên); nháp đang gõ dở thì mất. Sai 5 lần liên tiếp → như Quên PIN.

import { useEffect, useState } from "preact/hooks";
import { deviceStorage, MAX_PIN_FAILS, pinFails } from "../lib/pin";
import { forgetPin, unlock, useApp } from "../state/store";
import { Icon } from "../ui/icons";

const PIN_LENGTH = 6;
const failText = (left: number) => `Sai mã PIN, còn ${left} lần`;

export function Lock() {
  const { member, online } = useApp();
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  // Bộ đếm còn sau khi tải lại: mở app sau 2 lần sai vẫn thấy "còn 3 lần".
  const [error, setError] = useState<string | null>(() => {
    const fails = pinFails(deviceStorage());
    return fails > 0 ? failText(MAX_PIN_FAILS - fails) : null;
  });
  const [confirmForget, setConfirmForget] = useState(false);

  async function submit(full: string) {
    setBusy(true);
    const r = await unlock(full);
    if (r.ok || r.left === 0) return;
    setPin("");
    setBusy(false);
    setError(failText(r.left));
  }

  function press(digit: string) {
    if (busy || pin.length >= PIN_LENGTH) return;
    const next = pin + digit;
    setPin(next);
    if (next.length === PIN_LENGTH) void submit(next);
  }
  const back = () => !busy && setPin((p) => p.slice(0, -1));

  // Bàn phím máy tính: gõ số, xoá lùi.
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key)) press(e.key);
      else if (e.key === "Backspace") back();
      else return;
      e.preventDefault();
    };
    addEventListener("keydown", on);
    return () => removeEventListener("keydown", on);
  }, [pin, busy]);

  return (
    <main class="app lock" id="main" aria-labelledby="lock-title">
      <div class="lock-head">
        <span class="side-logo" aria-hidden="true">
          <Icon name="wallet" size={16} />
        </span>
        <h1 id="lock-title">Nhập mã PIN</h1>
        <p>{member?.name ? `Ví nhà của ${member.name}` : "Ví nhà"}</p>
      </div>
      <div class="lock-dots" role="img" aria-label={`Đã nhập ${pin.length} trên ${PIN_LENGTH} số`}>
        {Array.from({ length: PIN_LENGTH }, (_, i) => (
          <i key={i} class={i < pin.length ? "on" : ""} />
        ))}
      </div>
      <p class="err lock-err" role="alert">
        {busy ? null : error}
      </p>
      <div class="lock-pad">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
          <button type="button" key={d} class="btn" disabled={busy} onClick={() => press(d)}>
            {d}
          </button>
        ))}
        <span />
        <button type="button" class="btn" disabled={busy} onClick={() => press("0")}>
          0
        </button>
        <button type="button" class="btn btn-ghost" disabled={busy || !pin} onClick={back} aria-label="Xoá một số">
          <Icon name="chevron-left" size={22} />
        </button>
      </div>
      {confirmForget ? (
        <div class="lock-forget" role="alert">
          <p>
            Đăng xuất máy này? Đăng nhập lại bằng mật khẩu rồi đặt PIN mới. Khoản chưa gửi vẫn giữ.
            {!online && " Đang không có mạng: đăng nhập lại cần mạng."}
          </p>
          <div class="flex items-center gap-1">
            <button type="button" class="btn btn-primary" onClick={() => void forgetPin()}>
              Đăng xuất máy này
            </button>
            <button type="button" class="btn btn-ghost" onClick={() => setConfirmForget(false)}>
              Thôi
            </button>
          </div>
        </div>
      ) : (
        <button type="button" class="link lock-link" onClick={() => setConfirmForget(true)}>
          Quên mã PIN?
        </button>
      )}
    </main>
  );
}
