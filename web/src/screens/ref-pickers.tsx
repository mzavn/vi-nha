// Hai ô chọn "khoản nào" dùng chung cho màn Gán (UC-706) và Loại khác (UC-705):
//  - LinkSourcePicker: khoản tiền về trả cho khoản gốc nào (`link_id`) — tuỳ chọn. Hoàn tiền → khoản chi (chọn thì danh mục
//    & ví theo khoản đó); nhận lại tiền cho vay → khoản cho vay (chọn thì "Ai trả" theo người của khoản đó).
//  - ReceivablePicker: cho ai vay / ai trả (`receivable_id`), kèm "+ Người mới…" tạo khoản phải thu số 0 ngay tại chỗ.

import { useEffect, useRef, useState } from "preact/hooks";
import { api, errorText } from "../lib/api";
import { bookRefLabel } from "../lib/memo-books";
import { overpaidHint, receivableEffect, receivableOptions } from "../lib/receivables";
import { lendDiffText, linkCandidateLabel, linkPickHint, linkCandidatesPath, rankLinkCandidates, refundDiffText, type LinkKind } from "../lib/refunds";
import type { LinkCandidate, Receivable, ReceivableRef } from "../lib/types";
import { useResource } from "../state/resource";
import { getState, refresh, setState, useApp } from "../state/store";

/**
 * Ô "Trả lại cho khoản chi" (`kind="spend"`) / "Trả cho khoản cho vay" (`kind="lend"`): mục đầu "không chỉ khoản nào", rồi
 * tối đa 20 khoản gốc còn hiệu lực (khoản chi 30 ngày, khoản cho vay 180 ngày) — khoản của người `receivableId` trước, gần
 * `amount` nhất lên trước. Chọn một khoản → `onPick(id, khoản)`; khoản đang nối mà không còn trong danh sách (sửa khoản cũ)
 * vẫn giữ được, `onPick(id, null)`. Chưa chọn: gợi ý gán khoản gốc còn chờ trước. Không mạng thì không hiện.
 * `onlyReceivable`: chỉ khoản của người `receivableId` (sheet Nhận lại tiền của một người ở tab Nợ).
 */
export function LinkSourcePicker({
  id,
  kind,
  amount,
  value,
  receivableId = null,
  onlyReceivable = false,
  onPick,
}: {
  id: string;
  kind: LinkKind;
  amount: number;
  value: number | null;
  receivableId?: string | null;
  onlyReceivable?: boolean;
  onPick: (id: number | null, c: LinkCandidate | null) => void;
}) {
  const { online } = useApp();
  const res = useResource<LinkCandidate[]>(online ? linkCandidatesPath(kind) : null);
  if (!res.data && value === null) return null;
  const list = (res.data ?? []).filter((c) => !onlyReceivable || c.receivable_id === receivableId);
  const ranked = rankLinkCandidates(list, amount, receivableId);
  const chosen = list.find((c) => c.id === value) ?? null;
  if (chosen && !ranked.includes(chosen)) ranked.push(chosen);
  return (
    <>
      <div class="field">
        <label for={id}>{kind === "lend" ? "Trả cho khoản cho vay" : "Trả lại cho khoản chi"}</label>
        <select
          id={id}
          class="ctl"
          value={value === null ? "" : String(value)}
          onChange={(e) => {
            const v = Number(e.currentTarget.value) || null;
            onPick(v, list.find((c) => c.id === v) ?? null);
          }}
        >
          <option value="">không chỉ khoản nào</option>
          {value !== null && !chosen && <option value={String(value)}>{kind === "lend" ? "khoản cho vay đang nối" : "khoản chi đang nối"}</option>}
          {ranked.map((c) => (
            <option key={c.id} value={String(c.id)}>
              {linkCandidateLabel(kind, c)}
            </option>
          ))}
        </select>
      </div>
      {chosen ? (
        <p class="fhint">{kind === "lend" ? lendDiffText(chosen, amount) : refundDiffText(chosen, amount)}</p>
      ) : (
        value === null && <p class="fhint">{linkPickHint(kind, list, receivableId)}</p>
      )}
    </>
  );
}

const NEW_PERSON = "+new";

/**
 * Ô "Cho ai vay" / "Ai trả": mục đầu "không gắn khoản phải thu", mỗi khoản `bookRefLabel`, mục cuối "+ Người mới…" (cần mạng)
 * → hỏi tên → `POST /v1/receivables { name, amount: 0 }` → thêm vào bootstrap đang dùng, chọn luôn, rồi tải lại số.
 * Tên đã gõ mà rời ô (chạm chỗ khác, đóng sheet) thì cũng thêm luôn — không để mất tên. Đang hỏi tên thì `onPendingChange(true)`:
 * nơi dùng tắt nút ghi tới khi người được thêm (ghi lúc này là gửi khi chưa có người, `receivable_id` rỗng).
 * Dưới ô: người đó còn nợ bao nhiêu trước và sau khoản này; nhận lại vượt số còn nợ thì gợi ý tách phần dư thành Thu nhập
 * (`split`: màn Gán có Tách thêm dòng; Loại khác thì ghi riêng).
 */
export function ReceivablePicker({
  id,
  meaning,
  amount,
  receivables,
  value,
  onChange,
  onPendingChange,
  split = false,
}: {
  id: string;
  meaning: "lend" | "collect";
  amount: number;
  receivables: ReceivableRef[];
  value: string | null;
  onChange: (id: string | null) => void;
  onPendingChange?: (pending: boolean) => void;
  split?: boolean;
}) {
  const { online } = useApp();
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Rời ô rồi Enter / bấm Thêm người: chỉ gửi một lần.
  const sending = useRef(false);
  // Ô tên còn đang dùng. Huỷ, đã thêm, hay chọn người khác thì không còn: Chrome vẫn báo blur khi gỡ ô đang focus, không thêm lại.
  const open = useRef(false);
  const chosen = receivables.find((r) => r.id === value) ?? null;
  const effect = chosen && !naming ? receivableEffect(chosen, meaning, amount) : null;

  useEffect(() => {
    if (!naming) return;
    onPendingChange?.(true);
    return () => onPendingChange?.(false);
  }, [naming]);

  async function add() {
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Nhập tên người.");
      return;
    }
    if (sending.current) return;
    sending.current = true;
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<Receivable>("/v1/receivables", { name: trimmed, amount: 0 });
      const boot = getState().boot;
      if (boot) setState({ boot: { ...boot, receivables: [...(boot.receivables ?? []).filter((x) => x.id !== r.id), { id: r.id, name: r.name, balance: r.balance }] } });
      open.current = false;
      onChange(r.id);
      setNaming(false);
      setName("");
      void refresh();
    } catch (err) {
      setError(errorText(err));
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }

  return (
    <>
      <div class="field">
        <label for={id}>{meaning === "lend" ? "Cho ai vay" : "Ai trả"}</label>
        <select
          id={id}
          class="ctl"
          value={naming ? NEW_PERSON : value ?? ""}
          onChange={(e) => {
            const v = e.currentTarget.value;
            setError(null);
            open.current = v === NEW_PERSON;
            setNaming(v === NEW_PERSON);
            // Đang hỏi tên người mới thì chưa gắn ai: bấm Gán lúc này không gắn nhầm khoản đang chọn trước đó.
            onChange(v === NEW_PERSON ? null : v || null);
          }}
        >
          <option value="">không gắn khoản phải thu</option>
          {receivableOptions(receivables, meaning, value).map((r) => (
            <option key={r.id} value={r.id}>
              {bookRefLabel(r)}
            </option>
          ))}
          <option value={NEW_PERSON} disabled={!online}>
            {online ? "+ Người mới…" : "+ Người mới… (cần mạng)"}
          </option>
        </select>
      </div>
      {naming && (
        <>
          <div class="field">
            <label for={`${id}-new`}>Tên người mới</label>
            <input
              id={`${id}-new`}
              class="ctl"
              maxLength={120}
              placeholder="vd Chị Lan"
              autoFocus
              value={name}
              onInput={(e) => setName(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void add();
                }
              }}
              // Rời ô sang chỗ khác là xong tên: thêm luôn. Sang ô chọn người là đổi ý chọn người khác — không thêm.
              onBlur={(e) => {
                if (open.current && name.trim() && online && (e.relatedTarget as HTMLElement | null)?.id !== id) void add();
              }}
            />
          </div>
          <div class="field" style={{ justifyContent: "flex-end", borderTop: 0, paddingTop: 0 }}>
            {/* Chạm hai nút này không làm ô tên mất focus: Huỷ không được thêm người, Thêm người không gửi hai lần. */}
            <button
              type="button"
              class="btn btn-ghost"
              disabled={busy}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                open.current = false;
                setNaming(false);
              }}
            >
              Huỷ
            </button>
            <button type="button" class="btn" disabled={busy || !online} onMouseDown={(e) => e.preventDefault()} onClick={() => void add()}>
              {busy ? "Đang thêm…" : "Thêm người"}
            </button>
          </div>
          {error && (
            <p class="fhint err" role="alert">
              {error}
            </p>
          )}
        </>
      )}
      {effect && <p class="fhint">{effect.text}</p>}
      {effect && effect.overpaid > 0 && <p class="fhint">{overpaidHint(effect.overpaid, split)}</p>}
    </>
  );
}
