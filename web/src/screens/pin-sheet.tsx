// Mã PIN ở Cài đặt › Máy này (điện thoại) và chân thanh bên (máy tính) — pwa UC-719. Chỉ lưu ở máy: không cần mạng,
// không phụ thuộc cài đặt đã tải hay quyền chỉ-xem.

import { useState } from "preact/hooks";
import { changePin, createPinRecord, deviceStorage, isPinText, readPin, removePin, savePin, type PinCheck } from "../lib/pin";
import { forgetPin, toast, useApp } from "../state/store";
import { Sheet } from "../ui/parts";
import { Field, Hint } from "./settings-sheets";

type Mode = "set" | "change" | "off";

export const PIN_LIMITS =
  "Mã PIN chặn người cầm máy mở app, không thay mật khẩu. Quên PIN thì đăng xuất máy này rồi đăng nhập lại bằng mật khẩu. Safari chưa thêm ra màn hình chính có thể tự xoá dữ liệu sau 7 ngày không mở — khi đó PIN mất, phải đặt lại.";

/** PIN của người đang dùng có đặt trên máy này không (đọc lại mỗi lần vẽ — localStorage, đồng bộ). */
export function usePinSet(): boolean {
  const { member } = useApp();
  return readPin(deviceStorage(), member?.id ?? null) !== null;
}

/** Hàng "Mã PIN" của Máy này: Đặt, hoặc Đổi / Tắt khi đã có. */
export function PinRow() {
  const has = usePinSet();
  const [mode, setMode] = useState<Mode | null>(null);
  return (
    <>
      <div class="field">
        <span class="k">Mã PIN {has ? "· đang bật" : ""}</span>
        {has ? (
          <span class="flex items-center gap-1">
            <button type="button" class="btn" onClick={() => setMode("change")}>
              Đổi
            </button>
            <button type="button" class="btn" onClick={() => setMode("off")}>
              Tắt
            </button>
          </span>
        ) : (
          <button type="button" class="btn" onClick={() => setMode("set")}>
            Đặt mã PIN
          </button>
        )}
      </div>
      <div class="note">{PIN_LIMITS}</div>
      {mode && <PinSheet mode={mode} onClose={() => setMode(null)} />}
    </>
  );
}

const TITLE: Record<Mode, string> = { set: "Đặt mã PIN", change: "Đổi mã PIN", off: "Tắt mã PIN" };
const DONE: Record<Mode, string> = {
  set: "Đã đặt mã PIN. App hỏi PIN khi mở lại hoặc quay lại sau 1 phút.",
  change: "Đã đổi mã PIN.",
  off: "Đã tắt mã PIN trên máy này.",
};

/** `limits`: máy tính không có thẻ Máy này — câu giới hạn hiện ngay trong sheet. */
export function PinSheet({ mode, limits = false, onClose }: { mode: Mode; limits?: boolean; onClose: () => void }) {
  const { member } = useApp();
  const [f, setF] = useState({ old: "", pin: "", again: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<typeof f>) => setF((x) => ({ ...x, ...patch }));

  async function submit() {
    const storage = deviceStorage();
    if (!storage || !member) return setError("Máy này không lưu được dữ liệu (trình duyệt chặn bộ nhớ) — không bật được mã PIN.");
    if (mode !== "set" && !isPinText(f.old)) return setError("Nhập mã PIN đang dùng, đủ 6 số.");
    if (mode !== "off") {
      if (!isPinText(f.pin)) return setError("Mã PIN mới phải đúng 6 số.");
      if (f.pin !== f.again) return setError("Hai lần nhập mã PIN mới không khớp.");
    }
    setBusy(true);
    setError(null);
    let r: PinCheck;
    try {
      if (mode === "set") {
        savePin(storage, await createPinRecord(f.pin, member.id));
        r = { ok: true };
      } else r = mode === "change" ? await changePin(storage, member.id, f.old, f.pin) : await removePin(storage, member.id, f.old);
    } catch {
      setBusy(false);
      return setError("Máy này không lưu được mã PIN. Thử lại.");
    }
    if (r.ok) {
      toast(DONE[mode]);
      return onClose();
    }
    // Sai lần thứ 5: như Quên PIN — đăng xuất máy này.
    if (r.left === 0) return void forgetPin();
    setBusy(false);
    set({ old: "" });
    setError(`Sai mã PIN, còn ${r.left} lần.`);
  }

  const pinInput = (id: string, key: keyof typeof f) => (
    <input
      id={id}
      class="ctl"
      type="password"
      inputMode="numeric"
      pattern="[0-9]*"
      maxLength={6}
      autocomplete="off"
      value={f[key]}
      onInput={(ev) => set({ [key]: ev.currentTarget.value.replace(/\D/g, "").slice(0, 6) })}
    />
  );

  return (
    <Sheet open title={TITLE[mode]} onClose={onClose}>
      {mode !== "set" && (
        <Field id="pin-old" label="Mã PIN đang dùng" first>
          {pinInput("pin-old", "old")}
        </Field>
      )}
      {mode !== "off" && (
        <>
          <Field id="pin-new" label="Mã PIN mới (6 số)" first={mode === "set"}>
            {pinInput("pin-new", "pin")}
          </Field>
          <Field id="pin-again" label="Nhập lại mã PIN mới">
            {pinInput("pin-again", "again")}
          </Field>
        </>
      )}
      <Hint>
        {mode === "off"
          ? "Tắt thì mở app không hỏi PIN nữa. Sai 5 lần liên tiếp thì máy này đăng xuất."
          : "App hỏi PIN khi mở, hoặc khi quay lại sau từ 1 phút ở nền. Sai 5 lần liên tiếp thì máy này đăng xuất, đăng nhập lại bằng mật khẩu."}
        {limits && ` ${PIN_LIMITS}`}
      </Hint>
      <div class="pad">
        {error && (
          <p class="err" role="alert" style={{ margin: "0 0 8px" }}>
            {error}
          </p>
        )}
        <button type="button" class="btn btn-primary btn-wide" disabled={busy} onClick={() => void submit()}>
          {busy ? "Đang lưu…" : TITLE[mode]}
        </button>
      </div>
    </Sheet>
  );
}
